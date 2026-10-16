-- Run in the SQL Editor of your Gather Supabase project.
-- This migration grants no access until an owner is explicitly configured.
begin;

create table if not exists public.gather_owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid unique not null references auth.users(id) on delete cascade
);
alter table public.gather_owner enable row level security;
revoke all on public.gather_owner from anon, authenticated;
grant select on public.gather_owner to authenticated;
drop policy if exists owner_reads_self on public.gather_owner;
create policy owner_reads_self on public.gather_owner for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.is_gather_owner() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.gather_owner where user_id = (select auth.uid())) $$;
revoke all on function public.is_gather_owner() from public, anon;
grant execute on function public.is_gather_owner() to authenticated;

create table if not exists public.gather_items (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '', url text not null default '', note text not null default '',
  category text not null default '', tags jsonb not null default '[]'::jsonb check (jsonb_typeof(tags) = 'array'),
  created timestamptz not null default now(),
  kind text not null default 'link' check (kind in ('link','note','image','video','carousel')),
  import_status text not null default 'none' check (import_status in ('none','pending','importing','partial','complete','failed')),
  import_message text not null default '',
  unique(id,user_id)
);
create table if not exists public.gather_assets (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id text not null,
  filename text not null, mime text not null,
  original_name text not null default '', source text not null default '', source_key text not null default '',
  position integer not null default 0, size bigint not null check (size >= 0),
  foreign key(item_id,user_id) references public.gather_items(id,user_id) on delete cascade,
  unique(id,user_id)
);
create table if not exists public.gather_boards (
  id text primary key, user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null, description text not null default '', created timestamptz not null default now(),
  revision integer not null default 0, unique(id,user_id)
);
create table if not exists public.gather_elements (
  id text primary key, user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  board_id text not null, item_id text, text text not null default '',
  x double precision not null, y double precision not null,
  width double precision not null check (width >= 120), height double precision not null check (height >= 80),
  z integer not null, color text not null default 'paper' check (color in ('paper','sand','sage','rose')),
  foreign key(board_id,user_id) references public.gather_boards(id,user_id) on delete cascade,
  foreign key(item_id,user_id) references public.gather_items(id,user_id) on delete cascade
);
create table if not exists public.gather_projects (
  id text primary key, user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null, description text not null default '', notes text not null default '',
  created timestamptz not null default now(), unique(id,user_id)
);
create table if not exists public.gather_project_items (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id text not null, item_id text not null, primary key(project_id,item_id),
  foreign key(project_id,user_id) references public.gather_projects(id,user_id) on delete cascade,
  foreign key(item_id,user_id) references public.gather_items(id,user_id) on delete cascade
);
create table if not exists public.gather_project_boards (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id text not null, board_id text not null, primary key(project_id,board_id),
  foreign key(project_id,user_id) references public.gather_projects(id,user_id) on delete cascade,
  foreign key(board_id,user_id) references public.gather_boards(id,user_id) on delete cascade
);

do $$ declare t text; begin
  foreach t in array array['gather_items','gather_assets','gather_boards','gather_elements','gather_projects','gather_project_items','gather_project_boards'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists gather_owner_only on public.%I', t);
    execute format('create policy gather_owner_only on public.%I for all to authenticated using ((select public.is_gather_owner()) and user_id = (select auth.uid())) with check ((select public.is_gather_owner()) and user_id = (select auth.uid()))', t);
  end loop;
end $$;

create index if not exists gather_assets_item_position on public.gather_assets(item_id,position);
create index if not exists gather_elements_board on public.gather_elements(board_id);
create index if not exists gather_items_created on public.gather_items(user_id,created desc);

-- Atomic canvas replacement: revision check, layout, and revision update share a transaction.
create or replace function public.gather_save_board(p_board_id text, p_revision integer, p_elements jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare new_revision integer;
begin
  if not public.is_gather_owner() then raise exception 'Not authorized' using errcode='42501'; end if;
  if jsonb_typeof(p_elements) <> 'array' or jsonb_array_length(p_elements) > 1000 then raise exception 'Invalid board elements'; end if;
  update public.gather_boards set revision=revision+1 where id=p_board_id and user_id=auth.uid() and revision=p_revision returning revision into new_revision;
  if new_revision is null then raise exception 'Board revision conflict' using errcode='40001'; end if;
  delete from public.gather_elements where board_id=p_board_id;
  insert into public.gather_elements(id,user_id,board_id,item_id,text,x,y,width,height,z,color)
    select e.id,auth.uid(),p_board_id,nullif(e.item_id,''),coalesce(e.text,''),e.x,e.y,e.width,e.height,e.z,coalesce(e.color,'paper')
    from jsonb_to_recordset(p_elements) as e(id text,item_id text,text text,x double precision,y double precision,width double precision,height double precision,z integer,color text);
  return new_revision;
end $$;
revoke all on function public.gather_save_board(text,integer,jsonb) from public,anon;
grant execute on function public.gather_save_board(text,integer,jsonb) to authenticated;

create or replace function public.gather_set_project_links(p_project_id text,p_item_ids text[],p_board_ids text[])
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not public.is_gather_owner() then raise exception 'Not authorized' using errcode='42501'; end if;
  perform 1 from public.gather_projects where id=p_project_id and user_id=auth.uid() for update;
  if not found then raise exception 'Project not found'; end if;
  delete from public.gather_project_items where project_id=p_project_id;
  delete from public.gather_project_boards where project_id=p_project_id;
  insert into public.gather_project_items(user_id,project_id,item_id) select auth.uid(),p_project_id,id from (select distinct unnest(p_item_ids) as id) s;
  insert into public.gather_project_boards(user_id,project_id,board_id) select auth.uid(),p_project_id,id from (select distinct unnest(p_board_ids) as id) s;
end $$;
revoke all on function public.gather_set_project_links(text,text[],text[]) from public,anon;
grant execute on function public.gather_set_project_links(text,text[],text[]) to authenticated;

create or replace function public.gather_order_assets(p_item_id text,p_ids text[])
returns void language plpgsql security invoker set search_path = '' as $$
declare actual_count integer;
begin
  if not public.is_gather_owner() then raise exception 'Not authorized' using errcode='42501'; end if;
  perform 1 from public.gather_items where id=p_item_id and user_id=auth.uid() for update;
  if not found then raise exception 'Item not found'; end if;
  select count(*) into actual_count from public.gather_assets where item_id=p_item_id;
  if actual_count <> cardinality(p_ids) or actual_count <> (select count(distinct u.id) from unnest(p_ids) u(id)) or exists(select 1 from unnest(p_ids) u(id) where not exists(select 1 from public.gather_assets a where a.id=u.id and a.item_id=p_item_id)) then raise exception 'Slide list has changed'; end if;
  update public.gather_assets a set position=u.position-1 from unnest(p_ids) with ordinality u(id,position) where a.id=u.id and a.item_id=p_item_id;
end $$;
revoke all on function public.gather_order_assets(text,text[]) from public,anon;
grant execute on function public.gather_order_assets(text,text[]) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('gather-media','gather-media',false,52428800,array['image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif','image/tiff','image/bmp','video/mp4','video/webm','video/quicktime','video/x-matroska','video/x-msvideo','video/mpeg','video/3gpp'])
on conflict(id) do update set public=false;
drop policy if exists gather_private_media on storage.objects;
create policy gather_private_media on storage.objects for all to authenticated
using (bucket_id='gather-media' and (select public.is_gather_owner()) and (storage.foldername(name))[1]=(select auth.uid())::text)
with check (bucket_id='gather-media' and (select public.is_gather_owner()) and (storage.foldername(name))[1]=(select auth.uid())::text);

create or replace function public.gather_export() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'version',1,
    'items',coalesce((select jsonb_agg(i) from public.gather_items i),'[]'::jsonb),
    'assets',coalesce((select jsonb_agg(a) from public.gather_assets a),'[]'::jsonb),
    'boards',coalesce((select jsonb_agg(b) from public.gather_boards b),'[]'::jsonb),
    'elements',coalesce((select jsonb_agg(e) from public.gather_elements e),'[]'::jsonb),
    'projects',coalesce((select jsonb_agg(p) from public.gather_projects p),'[]'::jsonb),
    'project_items',coalesce((select jsonb_agg(pi) from public.gather_project_items pi),'[]'::jsonb),
    'project_boards',coalesce((select jsonb_agg(pb) from public.gather_project_boards pb),'[]'::jsonb)
  ) where public.is_gather_owner();
$$;
revoke all on function public.gather_export() from public,anon;
grant execute on function public.gather_export() to authenticated;
commit;
