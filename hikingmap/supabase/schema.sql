-- Схема hikingmap для Supabase.
-- Выполнить целиком в SQL Editor проекта. Идемпотентна: можно прогонять заново.
--
-- ⚠️ Но на **живой** базе лучше не прогонять целиком без нужды: файл идёт
-- одной транзакцией, и пока она открыта, часть таблиц под локом. Любую новую
-- правку кладите отдельным файлом в `patches/` и выполняйте только его —
-- тогда живые сессии и запросы сайта вообще не задеваются. Этот файл нужен
-- для чистой установки и для сверки «что должно быть в базе».
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

-- ⚠️⚠️ Триггер заводим **только если его нет**, а не через drop+create.
--
-- `drop trigger ... on auth.users` берёт на таблицу пользователей
-- ACCESS EXCLUSIVE и держит его **до конца транзакции**, а SQL Editor
-- прогоняет весь файл одной транзакцией. Пока лок держится, GoTrue не может
-- прочитать `auth.users`: обновление токена у живых сессий падает, и
-- supabase-js разлогинивает людей. Так на живой базе выкинуло двух вошедших
-- (фидбэк 2026-09-21).
--
-- Менять поведение триггера это не мешает: он ссылается на функцию по имени,
-- и `create or replace function` выше подменяет её тело без всякого лока.
do $$
begin
    if not exists (
        select 1 from pg_trigger t
         where t.tgname = 'on_auth_user_created'
           and t.tgrelid = 'auth.users'::regclass
           and not t.tgisinternal
    ) then
        create trigger on_auth_user_created
            after insert on auth.users
            for each row execute function public.handle_new_user();
    end if;
end $$;

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

-- ═════════════ Профили, приватность и друзья (сайт, этап 2) ════════════
-- Профиль открывается по нику: `totskiiwild.com/#u/grisha`.
--
-- ⚠️ Главное решение: **что видно, решает база**. У каждого блока профиля
-- своя видимость (`public` / `friends` / `private`), и собирает профиль
-- функция `get_public_profile` с правами владельца. На странице проверок нет
-- вовсе: она получает уже отфильтрованный ответ. Иначе «приватный профиль»
-- означал бы «страница не рисует блок», а данные всё равно уезжали бы
-- клиенту и были бы видны в отладчике.
--
-- Дружба при этом — формальность: она лишь переводит видимость `friends` из
-- «нет» в «да». Сама по себе прав не даёт.

alter table public.profiles add column if not exists username     text;
alter table public.profiles add column if not exists avatar_url   text;
alter table public.profiles add column if not exists bio          text;
alter table public.profiles add column if not exists visibility   text not null default 'public';
alter table public.profiles add column if not exists show_done    text not null default 'public';
alter table public.profiles add column if not exists show_planned text not null default 'public';
alter table public.profiles add column if not exists show_friends text not null default 'public';
alter table public.profiles add column if not exists show_stats   text not null default 'public';

-- Ник хранится в нижнем регистре: иначе `Grisha` и `grisha` — два разных
-- ника и две разные ссылки на один профиль.
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
    check (username is null or username ~ '^[a-z0-9_]{3,20}$');

create unique index if not exists profiles_username_key on public.profiles (username);

-- Видимость: `public` — всем, `friends` — только друзьям, `private` — никому.
-- `visibility` относится к профилю целиком: `private` закрывает и ссылку.
alter table public.profiles drop constraint if exists profiles_visibility_check;
alter table public.profiles add constraint profiles_visibility_check
    check (visibility in ('public', 'friends', 'private'));
alter table public.profiles drop constraint if exists profiles_show_done_check;
alter table public.profiles add constraint profiles_show_done_check
    check (show_done in ('public', 'friends', 'private'));
alter table public.profiles drop constraint if exists profiles_show_planned_check;
alter table public.profiles add constraint profiles_show_planned_check
    check (show_planned in ('public', 'friends', 'private'));
alter table public.profiles drop constraint if exists profiles_show_friends_check;
alter table public.profiles add constraint profiles_show_friends_check
    check (show_friends in ('public', 'friends', 'private'));
alter table public.profiles drop constraint if exists profiles_show_stats_check;
alter table public.profiles add constraint profiles_show_stats_check
    check (show_stats in ('public', 'friends', 'private'));

-- Аватар и имя из Google — сразу при регистрации, чтобы профиль не был пустым
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
    insert into public.profiles (id, display_name, avatar_url)
    values (new.id,
            new.raw_user_meta_data ->> 'full_name',
            coalesce(new.raw_user_meta_data ->> 'avatar_url',
                     new.raw_user_meta_data ->> 'picture'))
    on conflict (id) do nothing;
    return new;
end;
$$;

-- ───────────────────────────── Друзья ──────────────────────────────────
-- Одна строка на пару, направление хранится (кто позвал). Заявка —
-- `pending`, подтверждённая дружба — `accepted`. Отказ не хранится: строка
-- удаляется, иначе «отказал» превратилось бы в вечную метку.
create table if not exists public.friendships (
    requester  uuid not null references auth.users (id) on delete cascade,
    addressee  uuid not null references auth.users (id) on delete cascade,
    status     text not null default 'pending' check (status in ('pending', 'accepted')),
    created_at timestamptz not null default now(),
    primary key (requester, addressee),
    constraint friendships_not_self check (requester <> addressee)
);

create index if not exists friendships_addressee_idx on public.friendships (addressee, status);

alter table public.friendships enable row level security;

drop policy if exists "friendships: свои связи" on public.friendships;
create policy "friendships: свои связи"
    on public.friendships for select
    using (auth.uid() = requester or auth.uid() = addressee);

-- Заявку отправляет только сам, и только от своего имени
drop policy if exists "friendships: сам зовёт" on public.friendships;
create policy "friendships: сам зовёт"
    on public.friendships for insert
    with check (auth.uid() = requester);

-- Подтверждает только тот, кого позвали
drop policy if exists "friendships: подтверждает адресат" on public.friendships;
create policy "friendships: подтверждает адресат"
    on public.friendships for update
    using (auth.uid() = addressee)
    with check (auth.uid() = addressee);

-- Отменить заявку или расстаться может любая из сторон
drop policy if exists "friendships: расстаются оба" on public.friendships;
create policy "friendships: расстаются оба"
    on public.friendships for delete
    using (auth.uid() = requester or auth.uid() = addressee);

create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
    select exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and ((f.requester = a and f.addressee = b) or (f.requester = b and f.addressee = a))
    )
$$;

revoke all on function public.are_friends(uuid, uuid) from public;
grant execute on function public.are_friends(uuid, uuid) to authenticated;

-- ──────────────────── Чужой профиль по нику ────────────────────────────
-- Единственная дверь к чужому профилю. Возвращает **уже отфильтрованное**:
-- блок, который владелец закрыл, просто отсутствует в ответе.
--
-- `state`: 'ok' — профиль открыт, 'closed' — есть, но закрыт от вас,
-- 'not_found' — ника нет. Про закрытый профиль не сообщается ничего, даже
-- имени: иначе «приватный» означал бы «видно имя и аватар».
--
-- ⚠️ Геометрия чужих маршрутов не отдаётся. В списке — название, километры
-- и дата, а открыть на карте можно только то, что владелец сам открыл по
-- ссылке (`routes.shared`) или что лежит в каталоге (`route_key`). Иначе
-- публичный профиль стал бы способом выкачать чужие треки.
--   Сайт: client.rpc('get_public_profile', { handle: 'grisha' })
create or replace function public.get_public_profile(handle text)
returns jsonb
language plpgsql
stable
security definer set search_path = ''
as $$
declare
    p           public.profiles;
    h           text := lower(trim(handle));
    me          uuid := auth.uid();
    friend      boolean;
    rel         text;
    allowed     boolean;
    out_json    jsonb;
    can         boolean;
begin
    -- ⚠️ Принимаем и ник, и uuid. Пока принимался только ник, профиль
    -- человека, который ещё не выбрал ник, открыть было нечем — в списке
    -- друзей он висел безымянной строкой (фидбэк 2026-09-21).
    if h ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        select * into p from public.profiles pf where pf.id = h::uuid;
    else
        select * into p from public.profiles pf where pf.username = h;
    end if;

    if p.id is null then
        return jsonb_build_object('state', 'not_found');
    end if;

    friend := me is not null and public.are_friends(me, p.id);

    -- Как мы с ним связаны: none / pending_out / pending_in / friends / self
    if me = p.id then
        rel := 'self';
    elsif friend then
        rel := 'friends';
    elsif me is not null and exists (select 1 from public.friendships f
            where f.requester = me and f.addressee = p.id and f.status = 'pending') then
        rel := 'pending_out';
    elsif me is not null and exists (select 1 from public.friendships f
            where f.requester = p.id and f.addressee = me and f.status = 'pending') then
        rel := 'pending_in';
    else
        rel := 'none';
    end if;

    -- Видит ли вызывающий профиль целиком
    allowed := (rel = 'self')
            or (p.visibility = 'public')
            or (p.visibility = 'friends' and friend);

    if not allowed then
        -- ⚠️ `id` и `visibility` отдаём и здесь. Без `id` закрытому профилю
        -- нельзя отправить заявку в друзья, а именно этим он и открывается;
        -- без `visibility` интерфейс не знает, закрыт профиль от всех или
        -- только «для друзей», и писал «добавьтесь в друзья» даже тому, кто
        -- уже друг (фидбэк 2026-09-21). Имя и фото — только если вы уже
        -- как-то связаны: постороннему закрытый профиль не показывает ничего.
        return jsonb_build_object(
            'state', 'closed', 'friend', rel, 'id', p.id,
            'username', p.username, 'visibility', p.visibility,
            'display_name', case when rel <> 'none' then p.display_name end,
            'avatar_url',   case when rel <> 'none' then p.avatar_url end);
    end if;

    out_json := jsonb_build_object(
        'state', 'ok',
        'id', p.id,
        'username', p.username,
        'display_name', p.display_name,
        'avatar_url', p.avatar_url,
        'bio', p.bio,
        'friend', rel,
        'visibility', p.visibility
    );

    -- Пройденные: свои маршруты со статусом `done` плюс отметки на
    -- каталожных. У каталожного отдаём ключ — сайт откроет его сам.
    can := (rel = 'self') or (p.show_done = 'public') or (p.show_done = 'friends' and friend);
    if can then
        out_json := out_json || jsonb_build_object('done', coalesce((
            select jsonb_agg(x order by x -> 'date' desc nulls last) from (
                select jsonb_build_object('name', r.name, 'km', r.distance_km,
                                          'date', r.done_at, 'shared_id',
                                          case when r.shared then r.id else null end) as x
                  from public.routes r
                 where r.user_id = p.id and r.status = 'done'
                union all
                select jsonb_build_object('name', m.name, 'km', m.distance_km,
                                          'date', m.done_at, 'route_key', m.route_key) as x
                  from public.route_marks m
                 where m.user_id = p.id and m.status = 'done'
            ) q
        ), '[]'::jsonb));
    end if;

    -- Планируемые
    can := (rel = 'self') or (p.show_planned = 'public') or (p.show_planned = 'friends' and friend);
    if can then
        out_json := out_json || jsonb_build_object('planned', coalesce((
            select jsonb_agg(x order by x -> 'date' nulls last) from (
                select jsonb_build_object('name', r.name, 'km', r.distance_km,
                                          'date', r.planned_at, 'shared_id',
                                          case when r.shared then r.id else null end) as x
                  from public.routes r
                 where r.user_id = p.id and r.status = 'planned'
                union all
                select jsonb_build_object('name', m.name, 'km', m.distance_km,
                                          'date', m.planned_at, 'route_key', m.route_key) as x
                  from public.route_marks m
                 where m.user_id = p.id and m.status = 'planned'
            ) q
        ), '[]'::jsonb));
    end if;

    -- Достижения: считаются из пройденного, отдельной таблицы у них нет —
    -- иначе счёт разошёлся бы со списком
    can := (rel = 'self') or (p.show_stats = 'public') or (p.show_stats = 'friends' and friend);
    if can then
        out_json := out_json || jsonb_build_object('stats', (
            select jsonb_build_object(
                'done_km', round(coalesce(sum(km)::numeric, 0), 1),
                'done_count', count(*),
                'longest_km', round(coalesce(max(km)::numeric, 0), 1),
                'first_at', min(dt), 'last_at', max(dt))
              from (
                select r.distance_km as km, r.done_at as dt from public.routes r
                 where r.user_id = p.id and r.status = 'done'
                union all
                select m.distance_km, m.done_at from public.route_marks m
                 where m.user_id = p.id and m.status = 'done'
              ) s
        ));
    end if;

    -- Друзья
    can := (rel = 'self') or (p.show_friends = 'public') or (p.show_friends = 'friends' and friend);
    if can then
        -- ⚠️ `id` в списке обязателен, а ник может быть ещё не выбран:
        -- профиль такого друга открывается по id, и прятать его из списка
        -- (как было, `pr.username is not null`) нельзя — он висел там
        -- безымянной строкой, которая никуда не ведёт.
        out_json := out_json || jsonb_build_object('friends', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', pr.id, 'username', pr.username,
                       'display_name', pr.display_name, 'avatar_url', pr.avatar_url))
              from public.friendships f
              join public.profiles pr
                on pr.id = case when f.requester = p.id then f.addressee else f.requester end
             where f.status = 'accepted'
               and (f.requester = p.id or f.addressee = p.id)
        ), '[]'::jsonb));
    end if;

    return out_json;
end;
$$;

revoke all on function public.get_public_profile(text) from public;
grant execute on function public.get_public_profile(text) to anon, authenticated;

-- ──────────────────── Заявки в друзья: кто позвал ──────────────────────
-- Список входящих заявок с именами. Профили зовущих могут быть закрыты, но
-- имя и аватар того, кто **сам** к вам постучался, показать нужно — иначе
-- в списке будут безымянные строки.
create or replace function public.my_friend_requests()
returns jsonb
language sql
stable
security definer set search_path = ''
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
               'id', pr.id, 'username', pr.username,
               'display_name', pr.display_name, 'avatar_url', pr.avatar_url,
               'created_at', f.created_at) order by f.created_at desc), '[]'::jsonb)
      from public.friendships f
      join public.profiles pr on pr.id = f.requester
     where f.addressee = auth.uid() and f.status = 'pending'
$$;

revoke all on function public.my_friend_requests() from public, anon;
grant execute on function public.my_friend_requests() to authenticated;

-- Мои друзья — тем же видом, что и в чужом профиле
create or replace function public.my_friends()
returns jsonb
language sql
stable
security definer set search_path = ''
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
               'id', pr.id, 'username', pr.username,
               'display_name', pr.display_name, 'avatar_url', pr.avatar_url)), '[]'::jsonb)
      from public.friendships f
      join public.profiles pr
        on pr.id = case when f.requester = auth.uid() then f.addressee else f.requester end
     where f.status = 'accepted'
       and (f.requester = auth.uid() or f.addressee = auth.uid())
$$;

revoke all on function public.my_friends() from public, anon;
grant execute on function public.my_friends() to authenticated;

-- Свободен ли ник. Отдельной функцией: список профилей наружу закрыт RLS,
-- а проверить занятость нужно до сохранения, иначе человек узнаёт об этом
-- по ошибке уникального индекса.
create or replace function public.username_available(handle text)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
    select not exists (
        select 1 from public.profiles p
        where p.username = lower(trim(handle)) and p.id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
    )
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to authenticated;

-- ═══════════ Фото пользователя к пройденному маршруту (сайт) ═══════════
-- Отметив авторский маршрут пройденным, человек может приложить свои фото и
-- заметку — и в карточке маршрута он увидит **свой** отчёт: его фотографии
-- вместо авторских, его текст, без кнопки «Смотреть Reels» автора.
--
-- Фото лежат в Storage, путь `<user_id>/<route_key>/<uuid>.jpg` — первым
-- сегментом всегда id владельца, и на этом стоит вся защита: политика
-- сверяет его с `auth.uid()`. Бакет публичный на чтение: фото показываются
-- в карточке и в профиле, а подписанные ссылки потребовали бы серверной
-- функции ради каждой картинки.
--
-- ⚠️ Координаты фото храним рядом с путём (`{"p": "...", "c": [lon, lat]}`):
-- пережатие в браузере стирает EXIF, а GPS нужен, чтобы поставить фото на
-- тропу. Нет координат — `c: null`, и точку можно будет указать руками.

alter table public.route_marks add column if not exists photos jsonb not null default '[]'::jsonb;
alter table public.route_marks add column if not exists note   text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('route-photos', 'route-photos', true, 8388608,
        array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update
   set public             = true,
       file_size_limit    = 8388608,
       allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "route-photos: владелец пишет" on storage.objects;
create policy "route-photos: владелец пишет"
    on storage.objects for insert to authenticated
    with check (bucket_id = 'route-photos'
                and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "route-photos: владелец правит" on storage.objects;
create policy "route-photos: владелец правит"
    on storage.objects for update to authenticated
    using (bucket_id = 'route-photos'
           and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "route-photos: владелец удаляет" on storage.objects;
create policy "route-photos: владелец удаляет"
    on storage.objects for delete to authenticated
    using (bucket_id = 'route-photos'
           and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "route-photos: читают все" on storage.objects;
create policy "route-photos: читают все"
    on storage.objects for select
    using (bucket_id = 'route-photos');

-- Свои маршруты тоже держат фото и заметку — теми же колонками, что и
-- отметки на каталожных. Приложение пишет строку upsert'ом без них, и
-- значения сохраняются (как `shared` и `status` выше).
alter table public.routes add column if not exists photos jsonb not null default '[]'::jsonb;
alter table public.routes add column if not exists note   text;

-- ═════════════════ События: походы, чат и сборы (сайт) ═════════════════
-- Событие — «идём туда-то тогда-то»: маршрут, дата, лидеры и участники,
-- внутри чат и чек-лист общего снаряжения с ответственными.
--
-- ⚠️ Права здесь опаснее, чем в профилях: нужно, чтобы участники видели друг
-- друга и переписку, а посторонние — ничего, и при этом пришедший по ссылке
-- должен увидеть карточку **до** того, как вступит. Отсюда два приёма:
--
--   1. `is_event_member` / `is_event_leader` / `event_joinable` — функции с
--      правами владельца. Без них политика `events` смотрела бы в
--      `event_members`, политика `event_members` — в `events`, и RLS
--      уходил бы в бесконечную рекурсию (Postgres отвечает ошибкой
--      «infinite recursion detected in policy»).
--   2. `get_event` / `event_feed` — тоже с правами владельца: они отдают
--      карточку и переписку вместе с именами авторов. Напрямую участник
--      чужой профиль прочитать не может (RLS `profiles` — только свой), а
--      имена в чате нужны.
--
-- Идентификатор события — uuid, и по ссылке `#e/<id>` его видит любой, кому
-- ссылку дали: перебором uuid не находится.

create table if not exists public.events (
    id          uuid primary key default gen_random_uuid(),
    owner       uuid not null references auth.users (id) on delete cascade default auth.uid(),
    title       text not null,
    description text,
    starts_at   timestamptz,                -- сбор: дата и время
    ends_at     timestamptz,                -- возвращение: дата и время
    meeting     text,                       -- где сбор, словами
    meet_lat    double precision,           -- и точкой на карте
    meet_lon    double precision,
    route_key   text,                       -- 'route_3' / 'future_5' / 'my_<uuid>'
    route_name  text,
    route_km    double precision,
    visibility  text not null default 'link',
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- ⚠️ И то же самое `alter`-ами — **здесь, до функций**. Таблица могла быть
-- создана прежней версией файла, и тогда `create table if not exists` её не
-- тронет. А `my_events` ниже объявлена как `language sql`: её тело Postgres
-- проверяет **при создании**, и без этих колонок прогон файла падает на
-- `column e.ends_at does not exist` (фидбэк 2026-09-21). Дописывая колонку,
-- которую читает функция, ставь `alter` выше самой функции.
alter table public.events add column if not exists ends_at  timestamptz;
alter table public.events add column if not exists meet_lat double precision;
alter table public.events add column if not exists meet_lon double precision;

alter table public.events drop constraint if exists events_visibility_check;
alter table public.events add constraint events_visibility_check
    check (visibility in ('link', 'friends'));

create table if not exists public.event_members (
    event_id  uuid not null references public.events (id) on delete cascade,
    user_id   uuid not null references auth.users (id) on delete cascade default auth.uid(),
    role      text not null default 'member' check (role in ('leader', 'member')),
    joined_at timestamptz not null default now(),
    primary key (event_id, user_id)
);

create index if not exists event_members_user_idx on public.event_members (user_id);

create table if not exists public.event_messages (
    id         bigserial primary key,
    event_id   uuid not null references public.events (id) on delete cascade,
    user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
    body       text not null,
    created_at timestamptz not null default now()
);

create index if not exists event_messages_feed_idx on public.event_messages (event_id, id);

-- Чек-лист сборов: пункт можно назначить участнику, и он его отмечает
create table if not exists public.event_items (
    id         bigserial primary key,
    event_id   uuid not null references public.events (id) on delete cascade,
    title      text not null,
    assignee   uuid references auth.users (id) on delete set null,
    done       boolean not null default false,
    done_at    timestamptz,
    created_by uuid not null default auth.uid(),
    created_at timestamptz not null default now()
);

create index if not exists event_items_event_idx on public.event_items (event_id, id);

-- ─────────────────── Кто есть кто (без рекурсии RLS) ───────────────────
create or replace function public.is_event_member(ev uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
    select exists (select 1 from public.event_members m
                    where m.event_id = ev and m.user_id = auth.uid())
$$;

create or replace function public.is_event_leader(ev uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
    select exists (select 1 from public.event_members m
                    where m.event_id = ev and m.user_id = auth.uid() and m.role = 'leader')
$$;

/* Можно ли вступить: по ссылке — всем, «только друзья» — друзьям владельца */
create or replace function public.event_joinable(ev uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
    select exists (
        select 1 from public.events e
         where e.id = ev
           and auth.uid() is not null
           and (e.visibility = 'link'
                or (e.visibility = 'friends' and public.are_friends(auth.uid(), e.owner)))
    )
$$;

revoke all on function public.is_event_member(uuid), public.is_event_leader(uuid),
                       public.event_joinable(uuid) from public;
grant execute on function public.is_event_member(uuid), public.is_event_leader(uuid),
                          public.event_joinable(uuid) to authenticated;

-- ─────────────────────────── Политики ──────────────────────────────────
alter table public.events         enable row level security;
alter table public.event_members  enable row level security;
alter table public.event_messages enable row level security;
alter table public.event_items    enable row level security;

-- ⚠️ Владелец читает событие **по колонке owner**, а не только как
-- участник. Участником он становится триггером `on_event_created`, то есть
-- уже после вставки, — а `insert ... returning` проверяет строку политикой
-- на select в той же команде. Без этого создание похода честно записывало
-- строку и возвращало ошибку (фидбэк 2026-09-21).
drop policy if exists "events: участники читают" on public.events;
create policy "events: участники читают"
    on public.events for select
    using (auth.uid() = owner or public.is_event_member(id));

drop policy if exists "events: заводит сам" on public.events;
create policy "events: заводит сам"
    on public.events for insert with check (auth.uid() = owner);

drop policy if exists "events: правит лидер" on public.events;
create policy "events: правит лидер"
    on public.events for update using (public.is_event_leader(id))
    with check (public.is_event_leader(id));

-- Удалить событие может только владелец: лидеров может быть несколько, и
-- сносить общий поход не должен никто, кроме того, кто его собрал
drop policy if exists "events: удаляет владелец" on public.events;
create policy "events: удаляет владелец"
    on public.events for delete using (auth.uid() = owner);

drop policy if exists "members: участники видят друг друга" on public.event_members;
create policy "members: участники видят друг друга"
    on public.event_members for select using (public.is_event_member(event_id));

-- Вступают сами (если событие пускает) или добавляет лидер
drop policy if exists "members: вступление" on public.event_members;
create policy "members: вступление"
    on public.event_members for insert
    with check ((user_id = auth.uid() and public.event_joinable(event_id))
                or public.is_event_leader(event_id));

drop policy if exists "members: роли меняет лидер" on public.event_members;
create policy "members: роли меняет лидер"
    on public.event_members for update using (public.is_event_leader(event_id))
    with check (public.is_event_leader(event_id));

drop policy if exists "members: уходят сами, исключает лидер" on public.event_members;
create policy "members: уходят сами, исключает лидер"
    on public.event_members for delete
    using (user_id = auth.uid() or public.is_event_leader(event_id));

drop policy if exists "messages: участники читают" on public.event_messages;
create policy "messages: участники читают"
    on public.event_messages for select using (public.is_event_member(event_id));

drop policy if exists "messages: участники пишут" on public.event_messages;
create policy "messages: участники пишут"
    on public.event_messages for insert
    with check (user_id = auth.uid() and public.is_event_member(event_id));

drop policy if exists "messages: своё удаляет автор" on public.event_messages;
create policy "messages: своё удаляет автор"
    on public.event_messages for delete
    using (user_id = auth.uid() or public.is_event_leader(event_id));

-- Чек-лист правят все участники: это общие сборы, а не приказ. Кто взял
-- котелок, тот и отмечает — включая «я возьму вместо него»
drop policy if exists "items: участники читают" on public.event_items;
create policy "items: участники читают"
    on public.event_items for select using (public.is_event_member(event_id));

drop policy if exists "items: участники добавляют" on public.event_items;
create policy "items: участники добавляют"
    on public.event_items for insert with check (public.is_event_member(event_id));

drop policy if exists "items: участники правят" on public.event_items;
create policy "items: участники правят"
    on public.event_items for update using (public.is_event_member(event_id))
    with check (public.is_event_member(event_id));

drop policy if exists "items: удаляет автор или лидер" on public.event_items;
create policy "items: удаляет автор или лидер"
    on public.event_items for delete
    using (created_by = auth.uid() or public.is_event_leader(event_id));

-- Собравший событие сразу становится его лидером
create or replace function public.handle_new_event()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
    insert into public.event_members (event_id, user_id, role)
    values (new.id, new.owner, 'leader')
    on conflict (event_id, user_id) do update set role = 'leader';
    return new;
end;
$$;

drop trigger if exists on_event_created on public.events;
create trigger on_event_created
    after insert on public.events
    for each row execute function public.handle_new_event();

-- ──────────────── Карточка события, список, чат ────────────────────────
-- ⚠️ Функции с правами владельца, потому что участнику нужны **имена**
-- других участников и авторов сообщений, а чужой профиль RLS ему читать не
-- даёт. Плюс карточку должен увидеть пришедший по ссылке — до вступления он
-- ещё не участник, и обычный select его не пустит.
create or replace function public.get_event(ev uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
    e   public.events;
    mine text;
begin
    select * into e from public.events x where x.id = ev;
    if e.id is null then
        return jsonb_build_object('state', 'not_found');
    end if;

    select m.role into mine from public.event_members m
     where m.event_id = ev and m.user_id = auth.uid();

    -- Не участник и вступить не может — значит это не его событие
    if mine is null and not public.event_joinable(ev) then
        return jsonb_build_object('state', 'closed');
    end if;

    return jsonb_build_object(
        'state', 'ok',
        'id', e.id, 'title', e.title, 'description', e.description,
        'starts_at', e.starts_at, 'ends_at', e.ends_at, 'meeting', e.meeting,
        'meet_lat', e.meet_lat, 'meet_lon', e.meet_lon,
        'route_key', e.route_key, 'route_name', e.route_name, 'route_km', e.route_km,
        'visibility', e.visibility, 'owner', e.owner,
        'my_role', mine,
        'members', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', m.user_id, 'role', m.role,
                       'username', p.username, 'display_name', p.display_name,
                       'avatar_url', p.avatar_url)
                   order by (m.role = 'leader') desc, m.joined_at)
              from public.event_members m
              left join public.profiles p on p.id = m.user_id
             where m.event_id = ev), '[]'::jsonb),
        'items', case when mine is null then '[]'::jsonb else coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', i.id, 'title', i.title, 'assignee', i.assignee,
                       'done', i.done, 'created_by', i.created_by) order by i.id)
              from public.event_items i where i.event_id = ev), '[]'::jsonb) end,
        'messages_count', case when mine is null then 0 else
            (select count(*) from public.event_messages g where g.event_id = ev) end
    );
end;
$$;

revoke all on function public.get_event(uuid) from public;
grant execute on function public.get_event(uuid) to authenticated;

/* Мои события — с числом участников и ближайшей датой */
create or replace function public.my_events()
returns jsonb language sql stable security definer set search_path = ''
as $$
    select coalesce(jsonb_agg(x order by x -> 'starts_at' nulls last), '[]'::jsonb)
      from (
        select jsonb_build_object(
                   'id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
                   'route_name', e.route_name, 'route_km', e.route_km,
                   'my_role', m.role,
                   'members', (select count(*) from public.event_members k where k.event_id = e.id)
               ) as x
          from public.event_members m
          join public.events e on e.id = m.event_id
         where m.user_id = auth.uid()
      ) q
$$;

revoke all on function public.my_events() from public, anon;
grant execute on function public.my_events() to authenticated;

/* Вступить. Отдельной функцией: политика на insert это тоже позволяет, но
   через функцию клиенту не нужен доступ к таблице ради одной строки. */
create or replace function public.join_event(ev uuid)
returns text language plpgsql security definer set search_path = ''
as $$
begin
    if auth.uid() is null then return 'unauthenticated'; end if;
    if not public.event_joinable(ev) then return 'closed'; end if;
    insert into public.event_members (event_id, user_id, role)
    values (ev, auth.uid(), 'member')
    on conflict (event_id, user_id) do nothing;
    return 'ok';
end;
$$;

revoke all on function public.join_event(uuid) from public, anon;
grant execute on function public.join_event(uuid) to authenticated;

/* Переписка с именами авторов. `after_id` — только новое: чат опрашивается
   раз в несколько секунд, и таскать всю историю каждый раз незачем. */
create or replace function public.event_feed(ev uuid, after_id bigint default 0)
returns jsonb language sql stable security definer set search_path = ''
as $$
    select case when public.is_event_member(ev) then coalesce((
        select jsonb_agg(jsonb_build_object(
                   'id', g.id, 'user_id', g.user_id, 'body', g.body,
                   'created_at', g.created_at,
                   'display_name', p.display_name, 'avatar_url', p.avatar_url,
                   'username', p.username) order by g.id)
          from public.event_messages g
          left join public.profiles p on p.id = g.user_id
         where g.event_id = ev and g.id > coalesce(after_id, 0)
    ), '[]'::jsonb) else '[]'::jsonb end
$$;

revoke all on function public.event_feed(uuid, bigint) from public, anon;
grant execute on function public.event_feed(uuid, bigint) to authenticated;

