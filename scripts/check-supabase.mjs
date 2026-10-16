import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const db=new PGlite();let checks=0;
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const check=(value,message)=>{assert.ok(value,message);checks++;};
async function rejected(sql,message){try{await db.exec(sql);}catch{checks++;return;}throw new Error(message);}
async function role(name,user=''){await db.exec(`reset role; select set_config('request.jwt.claim.sub','${user}',false); set role ${name};`);}
try{
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text);
    insert into auth.users values('${owner}','medazizgatt@gmail.com'),('${other}','someone-else@example.com');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
    grant usage on schema public,auth,storage to authenticated,anon;
    grant all on storage.objects to authenticated;
  `);
  await db.exec(await readFile('supabase/migrations/202610160001_gather.sql','utf8'));
  check(true,'Schema migration applies to PostgreSQL');
  await role('authenticated',owner);
  await rejected("insert into public.gather_items(id,title) values('closed','should not save')",'Unconfigured owner must not write');
  await role('postgres');await db.exec(await readFile('supabase/set-owner.sql','utf8'));
  await role('authenticated',owner);
  await db.exec("insert into public.gather_items(id,title) values('item','My reference'); insert into public.gather_boards(id,title) values('board','My board'); insert into public.gather_projects(id,title) values('project','My project');");
  check((await db.query('select * from public.gather_items')).rows.length===1,'Configured owner can save and read');
  const elements=[{id:'element',item_id:'item',text:'',x:10,y:20,width:200,height:250,z:1,color:'paper'},{id:'note',item_id:null,text:'A thought',x:250,y:20,width:200,height:150,z:2,color:'sand'}];
  const saved=await db.query('select public.gather_save_board($1,$2,$3) as revision',['board',0,JSON.stringify(elements)]);
  check(saved.rows[0].revision===1,'Canvas RPC increments revision atomically');
  await rejected("select public.gather_save_board('board',0,'[]'::jsonb)",'Stale revision should fail');
  check((await db.query('select * from public.gather_elements')).rows.length===2,'Rejected canvas update preserves elements');
  await db.exec("insert into public.gather_assets(id,item_id,filename,mime,position,size) values('first','item','first.jpg','image/jpeg',0,100),('second','item','second.jpg','image/jpeg',1,100)");
  await db.query('select public.gather_order_assets($1,$2)',['item',['second','first']]);
  check((await db.query('select id from public.gather_assets order by position')).rows.map(a=>a.id).join(',')==='second,first','Carousel order RPC persists the complete ordered asset set');
  await rejected("select public.gather_order_assets('item',array['first','first'])",'Duplicate slide IDs must be rejected');
  await rejected(`insert into public.gather_items(id,user_id,title) values('spoofed','${other}','no')`,'Owner must not spoof another user ID');
  await db.query('select public.gather_set_project_links($1,$2,$3)',['project',['item'],['board']]);
  check((await db.query('select * from public.gather_project_items')).rows.length===1,'Project links are stored');
  await rejected("select public.gather_set_project_links('project',array['missing'],array['board'])",'Invalid relationship should fail');
  check((await db.query('select * from public.gather_project_items')).rows.length===1,'Invalid relationship replacement rolls back');
  await db.exec(`insert into storage.objects(bucket_id,name) values('gather-media','${owner}/item/image.jpg')`);
  check((await db.query('select * from storage.objects')).rows.length===1,'Owner can access private media');
  await rejected(`insert into storage.objects(bucket_id,name) values('gather-media','${other}/file.jpg')`,'Owner must not write another identity folder');
  await role('authenticated',other);
  check((await db.query('select * from public.gather_items')).rows.length===0,'Other accounts cannot read owner records');
  check((await db.query('select * from storage.objects')).rows.length===0,'Other accounts cannot read owner media');
  await rejected("insert into public.gather_items(id,title) values('intruder','no')",'Other accounts must not save records');
  await rejected(`insert into public.gather_owner(singleton,user_id) values(true,'${other}')`,'Other accounts must not claim ownership');
  await rejected("select public.gather_save_board('board',1,'[]'::jsonb)",'Other accounts must not execute owner mutations');
  await role('anon');await rejected('select * from public.gather_items','Anonymous access must be denied');
  await role('authenticated',owner);
  const snapshot=(await db.query('select public.gather_export() as snapshot')).rows[0].snapshot;
  check(snapshot.items.length===1&&snapshot.elements.length===2&&snapshot.project_boards.length===1,'Cloud backup snapshot contains records and relationships');
  await role('postgres');check((await db.query("select public from storage.buckets where id='gather-media'")).rows[0].public===false,'Media bucket is private');
  // Applying the schema twice keeps data and owner policies intact.
  await db.exec(await readFile('supabase/migrations/202610160001_gather.sql','utf8'));
  check((await db.query('select * from public.gather_items')).rows.length===1,'Schema re-application preserves records');
}finally{await db.close();}

// Exercise the actual cloud HTTP startup without creating accounts or writing to Supabase.
const dir=await mkdtemp(path.join(os.tmpdir(),'gather-cloud-check-'));
const server=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,GATHER_MODE:'supabase',HOST:'127.0.0.1',APP_ORIGIN:'',PORT:'4319',GATHER_DATA_DIR:dir},stdio:['ignore','pipe','pipe'],windowsHide:true});
let output='';server.stdout.on('data',c=>output+=c);server.stderr.on('data',c=>output+=c);
try{
  for(let i=0;i<100&&!output.includes('Gather is ready');i++)await new Promise(r=>setTimeout(r,100));
  check(output.includes('Gather is ready'),'Cloud server starts: '+output);
  const base='http://127.0.0.1:4319';
  const config=await(await fetch(base+'/api/config')).json();check(config.mode==='supabase','Cloud mode is explicit in runtime config');
  check((await fetch(base+'/api/state')).status===401,'Cloud records require a user session');
  check((await fetch(base+'/media/unknown')).status===401,'Cloud media require a user session');
  const session=await(await fetch(base+'/api/session')).json();check(session.authenticated===false,'Anonymous cloud session is not authenticated');
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'someone-else@example.com',password:'irrelevant'})});check(login.status===401,'Cloud login rejects an unconfigured email before contacting Auth');
  const origin=await fetch(base+'/api/login',{method:'POST',headers:{Origin:'https://unrelated.example','Content-Type':'application/json'},body:JSON.stringify({email:'medazizgatt@gmail.com',password:'irrelevant'})});check(origin.status===403,'Cloud cross-origin login is rejected');
  let localExists=true;try{await access(path.join(dir,'gather.sqlite'));}catch{localExists=false;}
  check(!localExists,'Cloud mode does not initialize or modify a local SQLite database');
}finally{
  server.kill();if(server.exitCode===null)await new Promise(r=>server.once('exit',r));
  assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(dir,{recursive:true,force:true});
}
console.log(`PASS: ${checks} Supabase schema, owner-isolation, RPC, storage, and cloud-startup checks.`);
