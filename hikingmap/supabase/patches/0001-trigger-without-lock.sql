-- Триггер профиля — без лока на auth.users.
--
-- Раньше `schema.sql` делал `drop trigger` + `create trigger` на
-- `auth.users` при каждом прогоне. Лок ACCESS EXCLUSIVE держался до конца
-- транзакции, GoTrue не мог обновить токены, и живые сессии выкидывало.
-- Здесь то же самое, но условно: если триггер уже есть, ничего не делаем.
--
-- Выполнять не обязательно (в базе триггер уже есть) — файл оставлен как
-- запись о правке и как безопасный способ его пересоздать.
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
