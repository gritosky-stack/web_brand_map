-- Авторская карточка маршрута каталога: фактический трек, фото, описание,
-- время в пути — и маршруты, опубликованные админом из своих.
--
-- До этой правки `catalog_status` хранил только статус и дату: сами маршруты
-- каталога лежат файлами в `www/`, и поменять у них можно было лишь цвет
-- метки. Но «пройден» — это не цвет: группа прошла не ровно по
-- запланированной тропе, фотографии появились свои, и время известно
-- фактическое. Поэтому строка каталога теперь может нести **замену**:
--
--   track        — фактический GPX в бакете `route-tracks` (путь внутри него).
--                  Есть он — сайт рисует его вместо файла из `www/`.
--   photos       — [{p, c}], как у `route_marks`: заменяют авторские фото.
--   note         — описание, заменяет авторское.
--   duration_min — сколько занял поход (из времени в треке или от админа).
--   name         — только у опубликованных (`pub_<uuid>`): в `www/` их нет.
--   distance_km  — километры опубликованного, чтобы списки не ждали разбора GPX.
--   source_id    — строка `routes`, из которой маршрут опубликован.
--
-- Права не меняются: читают все (от статуса зависит цвет метки у гостя),
-- пишет только админ — `is_admin()`.

alter table public.catalog_status add column if not exists name         text;
alter table public.catalog_status add column if not exists track        text;
alter table public.catalog_status add column if not exists photos       jsonb not null default '[]'::jsonb;
alter table public.catalog_status add column if not exists note         text;
alter table public.catalog_status add column if not exists duration_min integer;
alter table public.catalog_status add column if not exists distance_km  double precision;
alter table public.catalog_status add column if not exists source_id    uuid;

-- Треки — отдельным бакетом от фотографий: у тех политика пускает владельца
-- по первому сегменту пути (`<user_id>/…`), а трек каталога принадлежит не
-- человеку, а каталогу, и писать его может только админ.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('route-tracks', 'route-tracks', true, 20971520,
        array['application/gpx+xml', 'application/xml', 'text/xml',
              'application/octet-stream', 'text/plain'])
    on conflict (id) do update
   set public             = true,
       file_size_limit    = 20971520,
       allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "route-tracks: читают все" on storage.objects;
create policy "route-tracks: читают все"
    on storage.objects for select
    using (bucket_id = 'route-tracks');

drop policy if exists "route-tracks: пишет админ" on storage.objects;
create policy "route-tracks: пишет админ"
    on storage.objects for insert to authenticated
    with check (bucket_id = 'route-tracks' and public.is_admin());

drop policy if exists "route-tracks: правит админ" on storage.objects;
create policy "route-tracks: правит админ"
    on storage.objects for update to authenticated
    using (bucket_id = 'route-tracks' and public.is_admin());

drop policy if exists "route-tracks: удаляет админ" on storage.objects;
create policy "route-tracks: удаляет админ"
    on storage.objects for delete to authenticated
    using (bucket_id = 'route-tracks' and public.is_admin());
