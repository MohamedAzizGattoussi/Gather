-- Apply after the original Gather schema. Required before deploying to Vercel.
begin;
alter table public.gather_items add column if not exists import_lease_id uuid;
alter table public.gather_items add column if not exists import_expires_at timestamptz;

create or replace function public.gather_prepare_import(p_item_id text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare lease uuid;
begin
  if not public.is_gather_owner() then raise exception 'Not authorized' using errcode='42501'; end if;
  select import_lease_id into lease from public.gather_items where id=p_item_id and user_id=auth.uid() for update;
  if not found then raise exception 'Item not found'; end if;
  if exists(select 1 from public.gather_items where id=p_item_id and import_status in ('pending','importing') and import_expires_at>now()) then return null; end if;
  lease:=gen_random_uuid();
  update public.gather_items set import_lease_id=lease,import_expires_at=now()+interval '5 minutes',import_status='pending',import_message='' where id=p_item_id;
  return lease;
end $$;

create or replace function public.gather_start_import(p_item_id text,p_lease_id uuid) returns text
language plpgsql security invoker set search_path='' as $$
declare source text;
begin
  if not public.is_gather_owner() then raise exception 'Not authorized' using errcode='42501'; end if;
  update public.gather_items set import_status='importing' where id=p_item_id and user_id=auth.uid() and import_lease_id=p_lease_id and import_status='pending' and import_expires_at>now() returning url into source;
  return source;
end $$;

create or replace function public.gather_expire_imports() returns void
language sql security invoker set search_path='' as $$
  update public.gather_items set import_status='failed',import_message='Import was interrupted or took too long. Retry to collect missing slides.'
  where user_id=auth.uid() and public.is_gather_owner() and import_status in ('pending','importing') and (import_expires_at is null or import_expires_at<now());
$$;

create table if not exists public.gather_uploads(
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id text not null,
  filename text not null,
  original_name text not null default '',
  expected_size bigint not null check(expected_size>0 and expected_size<=157286400),
  expires timestamptz not null default now()+interval '2 hours',
  completed_at timestamptz,
  foreign key(item_id,user_id) references public.gather_items(id,user_id) on delete cascade
);
alter table public.gather_uploads enable row level security;
revoke all on public.gather_uploads from anon,authenticated;
grant select,insert,update,delete on public.gather_uploads to authenticated;
drop policy if exists gather_owner_only on public.gather_uploads;
create policy gather_owner_only on public.gather_uploads for all to authenticated
using((select public.is_gather_owner()) and user_id=(select auth.uid()))
with check((select public.is_gather_owner()) and user_id=(select auth.uid()));

create or replace function public.gather_finish_upload(p_upload_id text,p_mime text,p_size bigint) returns text
language plpgsql security invoker set search_path='' as $$
declare intent public.gather_uploads%rowtype; next_position integer; asset_count integer; first_mime text;
begin
  if not public.is_gather_owner() then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into intent from public.gather_uploads where id=p_upload_id and user_id=auth.uid() for update;
  if not found then raise exception 'Upload not found'; end if;
  if intent.completed_at is not null then return intent.id; end if;
  if intent.expires<now() or intent.expected_size<>p_size or p_mime!~'^(image|video)/' or p_mime='image/svg+xml' then raise exception 'Invalid or expired upload'; end if;
  perform 1 from public.gather_items where id=intent.item_id and user_id=auth.uid() for update;
  select coalesce(max(position),-1)+1 into next_position from public.gather_assets where item_id=intent.item_id;
  insert into public.gather_assets(id,user_id,item_id,filename,mime,original_name,position,size)
  values(intent.id,auth.uid(),intent.item_id,intent.filename,p_mime,intent.original_name,next_position,p_size);
  select count(*) into asset_count from public.gather_assets where item_id=intent.item_id;
  select mime into first_mime from public.gather_assets where item_id=intent.item_id order by position limit 1;
  update public.gather_items set kind=case when asset_count>1 then 'carousel' when first_mime like 'video/%' then 'video' else 'image' end where id=intent.item_id;
  update public.gather_uploads set completed_at=now() where id=intent.id;
  return intent.id;
end $$;

revoke all on function public.gather_prepare_import(text) from public,anon;
revoke all on function public.gather_start_import(text,uuid) from public,anon;
revoke all on function public.gather_expire_imports() from public,anon;
revoke all on function public.gather_finish_upload(text,text,bigint) from public,anon;
grant execute on function public.gather_prepare_import(text) to authenticated;
grant execute on function public.gather_start_import(text,uuid) to authenticated;
grant execute on function public.gather_expire_imports() to authenticated;
grant execute on function public.gather_finish_upload(text,text,bigint) to authenticated;
commit;
