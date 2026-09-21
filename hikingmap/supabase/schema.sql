-- Схема hikingmap для Supabase.
-- Выполнить целиком в SQL Editor проекта. Идемпотентна: можно прогонять заново.
--
-- Главное здесь — RLS. Anon-ключ уезжает внутрь приложения и доступен всем,
-- кто вскроет бандл; единственное, что отделяет данные одного пользователя
-- от другого, — политики ниже. Без них база публична на запись.

-- ─────────────────────────────── Профили ───────────────────────────────
create table if not exists public.profiles (
    id           uuid primary key references auth.users (id) on delete cascade,
    display_name text,
    updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: владелец читает" on public.profiles;
create policy "profiles: владелец читает"
    on public.profiles for select
    using (auth.uid() = id);

drop policy if exists "profiles: владелец пишет" on public.profiles;
create policy "profiles: владелец пишет"
    on public.profiles for insert
    with check (auth.uid() = id);

drop policy if exists "profiles: владелец правит" on public.profiles;
create policy "profiles: владелец правит"
    on public.profiles for update
    using (auth.uid() = id)
    with check (auth.uid() = id);

-- ─────────────────────────────── Маршруты ──────────────────────────────
-- Маршрут едет целиком в payload (jsonb) — это CustomRoute как есть.
-- Отдельными колонками вынесено только то, по чему имеет смысл фильтровать
-- и сортировать на стороне базы, чтобы не тащить payload ради списка.
create table if not exists public.routes (
    id           text primary key,
    user_id      uuid not null references auth.users (id) on delete cascade
                 default auth.uid(),
    name         text not null,
    distance_km  double precision not null default 0,
    recorded_at  timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    payload      jsonb not null
);

create index if not exists routes_user_recorded_idx
    on public.routes (user_id, recorded_at desc);

alter table public.routes enable row level security;

-- id маршрута приходит с устройства (UUID, сгенерированный приложением),
-- поэтому primary key общий на всех пользователей. Отсюда важное: в политике
-- на insert обязательна проверка user_id, иначе чужой id можно перетереть.
drop policy if exists "routes: владелец читает" on public.routes;
create policy "routes: владелец читает"
    on public.routes for select
    using (auth.uid() = user_id);

drop policy if exists "routes: владелец пишет" on public.routes;
create policy "routes: владелец пишет"
    on public.routes for insert
    with check (auth.uid() = user_id);

drop policy if exists "routes: владелец правит" on public.routes;
create policy "routes: владелец правит"
    on public.routes for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists "routes: владелец удаляет" on public.routes;
create policy "routes: владелец удаляет"
    on public.routes for delete
    using (auth.uid() = user_id);

-- Профиль заводим сразу при регистрации: приложение потом только правит имя.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
    insert into public.profiles (id, display_name)
    values (new.id, new.raw_user_meta_data ->> 'full_name')
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ─────────────────────────── Удаление аккаунта ─────────────────────────
-- Удалить пользователя из auth.users клиент с anon-ключом не может, а
-- service-ключ в бандл и на сайт класть нельзя. Поэтому — функция с правами
-- владельца, которая удаляет **только того, кто её вызвал** (auth.uid()).
-- Профиль и маршруты уходят каскадом (`on delete cascade` выше).
-- Нужна App Store (кнопка удаления аккаунта внутри приложения) и сайту.
--   Сайт:       client.rpc('delete_my_account')
--   Приложение: client.rpc("delete_my_account").execute(), затем signOut
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
    if auth.uid() is null then
        raise exception 'not authenticated';
    end if;
    delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ─────────────────────────── Маршрут по ссылке ─────────────────────────
-- Сайт даёт «Поделиться ссылкой» (`#shared_<id>`): маршрут видят все, у кого
-- есть ссылка, даже без входа. RLS при этом не ослабляем — политики на
-- select остаются «только владелец». Чужой маршрут отдаёт функция с правами
-- владельца и только по точному id и только если владелец включил `shared`.
-- Списка «всех расшаренных» нет, а id — UUID, перебором его не найти.
--
-- Колонку правит только владелец (политика «владелец правит» выше).
-- Приложение пишет строку upsert'ом без этой колонки — значение сохраняется.
--   Сайт: client.from('routes').update({ shared: true }).eq('id', id)
--         client.rpc('get_shared_route', { route_id: id })
alter table public.routes add column if not exists shared boolean not null default false;

create or replace function public.get_shared_route(route_id text)
returns table (id text, name text, payload jsonb, updated_at timestamptz)
language sql
stable
security definer set search_path = ''
as $$
    select r.id, r.name, r.payload, r.updated_at
    from public.routes r
    where r.id = route_id and r.shared
$$;

revoke all on function public.get_shared_route(text) from public;
grant execute on function public.get_shared_route(text) to anon, authenticated;

-- ═══════════════════ Статусы маршрутов и права (сайт) ══════════════════
-- Социальная часть сайта, этап 1. Три сущности:
--
--   1. `admins` + `is_admin()` — кто правит каталог. Раньше «владелец сайта»
--      был списком адресов в `www/premium.js`, то есть в бандле страницы;
--      статус маршрута правит база, и решать, кому это можно, обязана тоже она.
--   2. `catalog_status` — статус **авторского** маршрута каталога (пройден /
--      планируется). Сами маршруты лежат файлами в `www/`, в базе их нет, —
--      поэтому здесь только переопределение статуса по ключу (`route_3`).
--      Читают все, включая гостей: от статуса зависит цвет метки на карте.
--   3. Личные статусы. У своего маршрута — колонки в `routes`
--      (`status/planned_at/done_at`), у чужого (каталог, ПСС) — строка в
--      `route_marks`. Пройденные километры считаются по ним, у каждого свои.
--
-- ⚠️ Приложение пишет строку `routes` upsert'ом **без** новых колонок, и
-- значения сохраняются — как и `shared` выше. Поэтому статус, поставленный на
-- сайте, синхронизация из телефона не сбрасывает.

create table if not exists public.admins (
    email text primary key
);
insert into public.admins (email) values ('gritosky@gmail.com'), ('gritskij@gmail.com')
    on conflict (email) do nothing;

-- Список админов наружу не отдаём вовсе: RLS включён, политик на select нет,
-- а проверка идёт функцией с правами владельца.
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
    select exists (
        select 1 from public.admins a
        where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ─────────────── Статус авторского маршрута каталога ───────────────────
create table if not exists public.catalog_status (
    route_key  text primary key,               -- 'route_3', 'future_5'
    status     text not null,
    date       date,                           -- когда пройден / когда планируется
    updated_at timestamptz not null default now(),
    updated_by uuid default auth.uid()
);

-- Статусов три, и они же цвета метки на карте:
--   done    красный     пройден
--   planned оранжевый   скоро идём: на маршрут собирается группа (таких 1–2)
--   idle    фиолетовый  в запасе — задел, куда пока не идут
-- Отдельным alter, а не в create: таблица могла быть создана до появления
-- статуса `idle`, и тогда `create table if not exists` констрейнт не обновит.
alter table public.catalog_status drop constraint if exists catalog_status_status_check;
alter table public.catalog_status add constraint catalog_status_status_check
    check (status in ('done', 'planned', 'idle'));

alter table public.catalog_status enable row level security;

drop policy if exists "catalog_status: читают все" on public.catalog_status;
create policy "catalog_status: читают все"
    on public.catalog_status for select
    using (true);

drop policy if exists "catalog_status: пишет админ" on public.catalog_status;
create policy "catalog_status: пишет админ"
    on public.catalog_status for insert
    with check (public.is_admin());

drop policy if exists "catalog_status: правит админ" on public.catalog_status;
create policy "catalog_status: правит админ"
    on public.catalog_status for update
    using (public.is_admin())
    with check (public.is_admin());

drop policy if exists "catalog_status: удаляет админ" on public.catalog_status;
create policy "catalog_status: удаляет админ"
    on public.catalog_status for delete
    using (public.is_admin());

grant select on public.catalog_status to anon, authenticated;

-- ─────────────── Личный статус своего маршрута ─────────────────────────
alter table public.routes add column if not exists status      text not null default 'mine';
alter table public.routes add column if not exists planned_at  timestamptz;
alter table public.routes add column if not exists done_at     date;

alter table public.routes drop constraint if exists routes_status_check;
alter table public.routes add constraint routes_status_check
    check (status in ('mine', 'planned', 'done'));

create index if not exists routes_user_status_idx on public.routes (user_id, status);

-- ─────────────── Личный статус чужого маршрута ─────────────────────────
-- Каталожный или ПСС-маршрут принадлежит не пользователю, поменять у него
-- ничего нельзя — личная отметка живёт отдельной строкой. `distance_km` и
-- `name` копией: счётчик километров и список «Пройденные» собираются без
-- обращения к файлам маршрутов.
create table if not exists public.route_marks (
    user_id     uuid not null references auth.users (id) on delete cascade
                default auth.uid(),
    route_key   text not null,                 -- 'route_3', 'future_5', 'pss_<slug>'
    status      text not null check (status in ('planned', 'done')),
    name        text,
    distance_km double precision not null default 0,
    planned_at  timestamptz,
    done_at     date,
    updated_at  timestamptz not null default now(),
    primary key (user_id, route_key)
);

alter table public.route_marks enable row level security;

drop policy if exists "route_marks: владелец читает" on public.route_marks;
create policy "route_marks: владелец читает"
    on public.route_marks for select
    using (auth.uid() = user_id);

drop policy if exists "route_marks: владелец пишет" on public.route_marks;
create policy "route_marks: владелец пишет"
    on public.route_marks for insert
    with check (auth.uid() = user_id);

drop policy if exists "route_marks: владелец правит" on public.route_marks;
create policy "route_marks: владелец правит"
    on public.route_marks for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists "route_marks: владелец удаляет" on public.route_marks;
create policy "route_marks: владелец удаляет"
    on public.route_marks for delete
    using (auth.uid() = user_id);
