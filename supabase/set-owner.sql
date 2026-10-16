-- First create your Gather application user in Authentication > Users > Add user.
-- Use the email below and choose a strong password privately in the dashboard.
-- Then run this in the SQL Editor, AFTER the schema migration.
do $$
declare owner_id uuid;
begin
  select id into owner_id from auth.users where lower(email)='medazizgatt@gmail.com';
  if owner_id is null then raise exception 'Create medazizgatt@gmail.com in Authentication > Users first. Your Supabase dashboard login is separate from this app user.'; end if;
  if exists(select 1 from public.gather_owner where user_id<>owner_id) then raise exception 'A different Gather owner is already configured. No ownership was changed.'; end if;
  insert into public.gather_owner(singleton,user_id) values(true,owner_id) on conflict(singleton) do nothing;
end $$;
