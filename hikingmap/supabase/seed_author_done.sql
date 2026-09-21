-- Разовое сеяние: авторские пройденные маршруты каталога — в личные
-- «Пройденные» владельца каталога.
--
-- Зачем отдельным файлом, а не кнопкой в интерфейсе: это одноразовая правка
-- данных одного аккаунта, а не функция сайта. Идемпотентна (`on conflict`),
-- прогонять можно сколько угодно.
--
-- Километры и даты взяты из каталога сайта (`www/routes_geom.json` и
-- `routesList` в `www/script.js`) — теми же цифрами, что видит посетитель.
-- Маршруты без даты в каталоге получают `done_at = null`: дата неизвестна,
-- и врать её не надо — в счётчике километров она не участвует.
--
-- Выполнить в SQL Editor Supabase **после** schema.sql.

insert into public.route_marks (user_id, route_key, status, name, distance_km, done_at)
select u.id, v.route_key, 'done', v.name, v.km, v.done_at
  from auth.users u,
       (values
    ('route_0', 'Samari - Lastra', 22.66, '2026-03-01'::date),
    ('route_1', 'Gvozdacke Stene', 18.12, '2026-03-08'::date),
    ('route_2', 'Lastra - Divcibare', 19.49, '2026-03-15'::date),
    ('route_3', 'Samari - Magleš (Pali)', 19.59, '2026-02-14'::date),
    ('route_4', 'Medednik - Bucurska pecina', 21.83, '2026-03-07'::date),
    ('route_5', 'Valjevo - Gradac River Canyon', 19.21, null),
    ('route_6', 'Istoćni Maljen - Mokra Pecina', 23.83, '2026-02-15'::date),
    ('route_7', 'Бељаница - Богојављенски успон', 18.31, '2026-03-22'::date),
    ('route_8', 'Ovčar', 11.36, '2026-04-19'::date),
    ('route_9', 'Debelo Brdo - Jablanik', 15.56, null),
    ('route_10', 'Lastra - Magleš - Kušakovići', 21.21, null),
    ('route_11', 'Ostrvica', 2.03, null),
    ('route_12', 'Maglić - Stolovi', 9.03, null),
    ('route_13', 'Đerdap - Ploče - Veliki Štrbac', 15.92, '2026-05-30'::date),
    ('route_14', 'Vrutci Camping', 27.68, '2026-06-06'::date),
    ('route_15', 'Samari - Dren. Kik Camp', 8.5, '2026-07-19'::date),
    ('route_16', 'Vrutci Camping 2', 23.55, '2026-07-25'::date),
    ('route_17', 'Samari - Taorske Stene Camp', 19.68, '2026-08-09'::date)
       ) as v(route_key, name, km, done_at)
 where u.email = 'gritosky@gmail.com'
    on conflict (user_id, route_key) do update
   set status      = 'done',
       name        = excluded.name,
       distance_km = excluded.distance_km,
       done_at     = excluded.done_at,
       updated_at  = now();
