import express from 'express';
import multer from 'multer';
import { ZipArchive } from 'archiver';
import { mkdirSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { clientFor, result, requireOwner, cloudState } from './cloud-client.mjs';
import { ownerEmail, appOrigin, storageBucket, maxFileMB } from './config.mjs';
import { validUrl } from './source-resolver.mjs';
import { cloudStoreMedia, enqueueCloudImport, activeImports } from './cloud-imports.mjs';

export const cloudRouter=express.Router();
const secure=appOrigin.startsWith('https://');
const temp=path.join(os.tmpdir(),'gather-cloud-uploads');mkdirSync(temp,{recursive:true});
const upload=multer({dest:temp,limits:{fileSize:maxFileMB*1024*1024,files:40,fields:4}});
const text=(v,max=20000)=>typeof v==='string'?v.trim().slice(0,max):'';
const title=v=>text(v,240);
const tags=v=>[...new Set((Array.isArray(v)?v:[]).filter(t=>typeof t==='string').map(t=>text(t,80)).filter(Boolean))].slice(0,50);
const attempts=new Map();
let exporting=false;
function cookie(req,name){return(req.headers.cookie||'').split(';').map(c=>c.trim()).find(c=>c.startsWith(`${name}=`))?.slice(name.length+1)||'';}
function setCookies(res,session){
  const suffix=`; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure?'; Secure':''}`;
  res.setHeader('Set-Cookie',[`gather_access=${session.access_token}${suffix}`,`gather_refresh=${session.refresh_token}${suffix}`]);
}
function clearCookies(res){res.setHeader('Set-Cookie',['gather_access','gather_refresh'].map(n=>`${n}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure?'; Secure':''}`));}
async function context(req,res){
  const access=cookie(req,'gather_access'),refresh=cookie(req,'gather_refresh');
  if(!access||!refresh)return null;
  const client=clientFor();
  const {data,error}=await client.auth.setSession({access_token:access,refresh_token:refresh});
  if(error||!data.session||!data.user)return null;
  await requireOwner(client,data.user);
  if(data.session.access_token!==access||data.session.refresh_token!==refresh)setCookies(res,data.session);
  return{client,user:data.user,accessToken:data.session.access_token};
}
async function itemFor(client,id){const item=result(await client.from('gather_items').select('*').eq('id',id).maybeSingle());if(!item)throw Object.assign(new Error('This reference no longer exists.'),{status:404});return item;}
cloudRouter.get('/api/session',async(req,res)=>{
  const ctx=await context(req,res);
  res.json({authenticated:!!ctx,mode:'supabase',maxFileMB});
});
cloudRouter.post('/api/login',async(req,res)=>{
  const remote=req.ip||'unknown';const recent=(attempts.get(remote)||[]).filter(t=>t>Date.now()-60000);
  if(recent.length>=10)return res.status(429).json({error:'A few too many attempts. Try again in a minute.'});
  recent.push(Date.now());attempts.set(remote,recent);
  if(attempts.size>1000)for(const[key,times]of attempts)if(!times.some(t=>t>Date.now()-60000))attempts.delete(key);
  const {email,password}=req.body||{};
  if(typeof email!=='string'||email.toLowerCase().trim()!==ownerEmail||typeof password!=='string'||password.length>1024)return res.status(401).json({error:'The email or password does not match.'});
  const client=clientFor();
  const {data,error}=await client.auth.signInWithPassword({email:email.trim(),password});
  if(error||!data.session)return res.status(401).json({error:'The email or password does not match.'});
  await requireOwner(client,data.user);
  attempts.delete(remote);setCookies(res,data.session);res.json({ok:true});
});
cloudRouter.use(['/api','/media'],async(req,res,next)=>{
  const ctx=await context(req,res);
  if(!ctx)return res.status(401).json({error:'Sign in to open your Gather collection.'});
  if(exporting&&!['GET','HEAD'].includes(req.method))return res.status(409).json({error:'A backup is being prepared. Try again when it finishes.'});
  req.gather=ctx;next();
});
cloudRouter.post('/api/logout',async(req,res)=>{await req.gather.client.auth.signOut({scope:'local'});clearCookies(res);res.json({ok:true});});
cloudRouter.get('/api/state',async(req,res)=>{
  const client=req.gather.client;
  // A single app/worker process owns imports. After a restart, an owner can retry
  // interrupted jobs rather than leaving their records permanently 'importing'.
  const pending=result(await client.from('gather_items').select('id').in('import_status',['pending','importing']));
  const interrupted=pending.filter(i=>!activeImports.has(i.id));
  if(interrupted.length)result(await client.from('gather_items').update({import_status:'failed',import_message:'Import was interrupted. You can retry it.'}).in('id',interrupted.map(i=>i.id)));
  res.json(await cloudState(client));
});
cloudRouter.post('/api/items',async(req,res)=>{
  const b=req.body||{},url=text(b.url,4000);if(url)validUrl(url);
  if(!url&&!text(b.note)&&!b.hasFiles)return res.status(400).json({error:'Add a link, a note, or a file first.'});
  const item={id:randomUUID(),title:title(b.title),url,note:text(b.note),category:text(b.category,80),tags:tags(b.tags),kind:url?'link':'note'};
  result(await req.gather.client.from('gather_items').insert(item));
  if(url&&b.import!==false)await enqueueCloudImport(req.gather,item);
  res.status(201).json({id:item.id});
});
cloudRouter.patch('/api/items/:id',async(req,res)=>{
  const client=req.gather.client,item=await itemFor(client,req.params.id),b=req.body||{};
  const url=b.url===undefined?item.url:text(b.url,4000);if(url)validUrl(url);
  result(await client.from('gather_items').update({title:b.title===undefined?item.title:title(b.title),url,note:b.note===undefined?item.note:text(b.note),category:b.category===undefined?item.category:text(b.category,80),tags:b.tags===undefined?item.tags:tags(b.tags)}).eq('id',item.id));
  res.json({ok:true});
});
cloudRouter.delete('/api/items/:id',async(req,res)=>{
  const client=req.gather.client;await itemFor(client,req.params.id);
  if(activeImports.has(req.params.id))return res.status(409).json({error:'Wait for this import to finish before deleting the reference.'});
  const assets=result(await client.from('gather_assets').select('filename').eq('item_id',req.params.id));
  result(await client.from('gather_items').delete().eq('id',req.params.id));
  if(assets.length)await client.storage.from(storageBucket).remove(assets.map(a=>a.filename));
  res.json({ok:true});
});
cloudRouter.post('/api/items/:id/media',async(req,res,next)=>{await itemFor(req.gather.client,req.params.id);next();},upload.array('files',40),async(req,res)=>{
  const files=req.files||[];let saved=0;
  try{
    if(!files.length)return res.status(400).json({error:'Choose image or video files to attach.'});
    for(const file of files){await cloudStoreMedia(req.gather.client,req.gather.user.id,req.params.id,await readFile(file.path),file.originalname);saved++;}
    res.json({ok:true,saved});
  }catch(e){res.status(400).json({error:`${saved?`${saved} files saved. `:''}${e.message}`});}
  finally{await Promise.all(files.map(f=>unlink(f.path).catch(()=>{})));}
});
cloudRouter.patch('/api/items/:id/media-order',async(req,res)=>{
  await itemFor(req.gather.client,req.params.id);
  if(!Array.isArray(req.body.ids)||req.body.ids.some(id=>typeof id!=='string'))return res.status(400).json({error:'Invalid slide list.'});
  result(await req.gather.client.rpc('gather_order_assets',{p_item_id:req.params.id,p_ids:req.body.ids}));res.json({ok:true});
});
cloudRouter.post('/api/items/:id/import',async(req,res)=>{if(exporting)return res.status(409).json({error:'Wait for the backup to finish.'});const item=await itemFor(req.gather.client,req.params.id);if(!item.url)return res.status(400).json({error:'Add a source link first.'});await enqueueCloudImport(req.gather,item);res.json({ok:true});});
cloudRouter.get('/media/:id',async(req,res)=>{
  const client=req.gather.client,asset=result(await client.from('gather_assets').select('filename').eq('id',req.params.id).maybeSingle());
  if(!asset)return res.sendStatus(404);
  const signed=result(await client.storage.from(storageBucket).createSignedUrl(asset.filename,60));
  // Do not expose the signed URL to the browser; proxy media and Range headers.
  const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),120000);
  const response=await fetch(signed.signedUrl,{headers:req.headers.range?{Range:req.headers.range}:{},signal:abort.signal});
  if(!response.ok&&response.status!==206){clearTimeout(timer);return res.sendStatus(response.status===404?404:502);}
  for(const header of ['content-type','content-length','content-range','accept-ranges'])if(response.headers.has(header))res.setHeader(header,response.headers.get(header));
  res.status(response.status);res.once('close',()=>{clearTimeout(timer);abort.abort();});
  const stream=Readable.fromWeb(response.body);stream.on('error',()=>{clearTimeout(timer);res.destroy();});stream.pipe(res);
});
for(const type of ['boards','projects']){
  cloudRouter.post(`/api/${type}`,async(req,res)=>{const name=title(req.body?.title);if(!name)return res.status(400).json({error:'Give it a name first.'});const id=randomUUID();result(await req.gather.client.from(`gather_${type}`).insert({id,title:name}));res.status(201).json({id});});
  cloudRouter.patch(`/api/${type}/:id`,async(req,res)=>{
    const client=req.gather.client,entry=result(await client.from(`gather_${type}`).select('*').eq('id',req.params.id).maybeSingle());
    if(!entry)return res.status(404).json({error:'This workspace no longer exists.'});
    const b=req.body,name=b.title===undefined?entry.title:title(b.title);if(!name)return res.status(400).json({error:'Give it a name first.'});
    result(await client.from(`gather_${type}`).update({title:name,description:b.description===undefined?entry.description:text(b.description),...(type==='projects'?{notes:b.notes===undefined?entry.notes:text(b.notes,100000)}:{})}).eq('id',entry.id));res.json({ok:true});
  });
  cloudRouter.delete(`/api/${type}/:id`,async(req,res)=>{result(await req.gather.client.from(`gather_${type}`).delete().eq('id',req.params.id));res.json({ok:true});});
}
cloudRouter.put('/api/boards/:id/elements',async(req,res)=>{
  const {revision,elements}=req.body;
  if(!Number.isInteger(revision)||!Array.isArray(elements)||elements.length>1000)return res.status(400).json({error:'Invalid board layout.'});
  const ids=new Set();
  for(const e of elements){if(typeof e.id!=='string'||e.id.length>80||ids.has(e.id)||[e.x,e.y,e.width,e.height,e.z].some(n=>!Number.isFinite(n)||Math.abs(n)>100000)||e.width<120||e.height<80)return res.status(400).json({error:'Invalid board element.'});ids.add(e.id);}
  const next=result(await req.gather.client.rpc('gather_save_board',{p_board_id:req.params.id,p_revision:revision,p_elements:elements.map(e=>({...e,text:text(e.text),z:Math.round(e.z)}))}));res.json({revision:next});
});
cloudRouter.put('/api/projects/:id/links',async(req,res)=>{
  const {itemIds,boardIds}=req.body;
  if(!Array.isArray(itemIds)||!Array.isArray(boardIds)||itemIds.length+boardIds.length>5000||[...itemIds,...boardIds].some(id=>typeof id!=='string'))return res.status(400).json({error:'Invalid project links.'});
  result(await req.gather.client.rpc('gather_set_project_links',{p_project_id:req.params.id,p_item_ids:itemIds,p_board_ids:boardIds}));res.json({ok:true});
});
cloudRouter.post('/api/password',async(req,res)=>{
  const {current,password}=req.body;
  if(typeof current!=='string'||typeof password!=='string'||password.length<12||password.length>1024)return res.status(400).json({error:'Use a new password of at least 12 characters.'});
  const verify=clientFor();const {error}=await verify.auth.signInWithPassword({email:req.gather.user.email,password:current});
  if(error)return res.status(400).json({error:'Current password does not match.'});
  result(await req.gather.client.auth.updateUser({password}));await verify.auth.signOut({scope:'local'});res.json({ok:true});
});
cloudRouter.get('/api/settings',(req,res)=>res.json({mode:'supabase',dataDir:'Your private Gather cloud storage',maxFileMB}));
cloudRouter.get('/api/backup',async(req,res)=>{
  if(exporting||activeImports.size)return res.status(409).json({error:'Wait for imports or the current backup to finish before downloading a backup.'});
  exporting=true;
  const archive=new ZipArchive({zlib:{level:6}});
  try{
    const snapshot=result(await req.gather.client.rpc('gather_export'));
    res.attachment(`Gather-cloud-backup-${new Date().toISOString().slice(0,10)}.zip`);
    archive.on('error',error=>res.destroy(error));res.once('close',()=>{exporting=false;archive.abort();});archive.pipe(res);
    archive.append(JSON.stringify(snapshot,null,2),{name:'gather.json'});
    archive.append('Gather Supabase backup: gather.json contains records, media/ contains original files. Restore into a configured single-owner project using npm run restore:supabase -- <archive.zip>. Local SQLite data and hosted data are separate. Keep this archive private.\n',{name:'RESTORE.txt'});
    for(const asset of snapshot.assets){
      const signed=result(await req.gather.client.storage.from(storageBucket).createSignedUrl(asset.filename,120));
      const response=await fetch(signed.signedUrl,{signal:AbortSignal.timeout(120000)});
      if(!response.ok)throw new Error('A saved media file could not be backed up.');
      const stream=Readable.fromWeb(response.body);
      archive.append(stream,{name:`media/${asset.id}`});
      await new Promise((resolve,reject)=>{stream.once('end',resolve);stream.once('error',reject);});
    }
    await archive.finalize();
  }catch(e){exporting=false;archive.abort();if(res.headersSent)res.destroy(e);else res.status(500).json({error:'Cloud backup could not be completed. Try again.'});}
});
cloudRouter.use('/api',(req,res)=>res.status(404).json({error:'This action was not found.'}));
cloudRouter.use((error,req,res,next)=>{
  if(req.files)Promise.all(req.files.map(f=>unlink(f.path).catch(()=>{}))).catch(()=>{});
  if(res.headersSent)return next(error);
  res.status(error.status||400).json({error:error.code==='LIMIT_FILE_SIZE'?`Each cloud file can be up to ${maxFileMB} MB.`:error.message||'Something went wrong. Try again.'});
});
