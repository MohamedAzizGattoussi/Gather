import assert from 'node:assert/strict';
import { readFile,mkdtemp,access,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { getTransformedRoutes } from '@vercel/routing-utils';

let checks=0;
const check=(value,message)=>{assert.ok(value,message);checks++;};
const config=JSON.parse(await readFile('vercel.json','utf8'));
const transformed=getTransformedRoutes(config);
check(!transformed.error,'Vercel accepts the routing configuration');
check(config.framework==='vite'&&config.outputDirectory==='dist','Vercel serves the built Vite frontend');
check(config.functions['api/import.py'].maxDuration===300,'Python import has a bounded function duration');
const routes=transformed.routes.filter(route=>route.dest);
const destination=url=>routes.find(route=>new RegExp(route.src).test(url))?.dest?.split('?')[0];
check(destination('/api/config')==='/api'&&destination('/media/reference')==='/api','API and private media go to the Node handler');
check(destination('/boards/a-board')==='/index.html'&&destination('/projects/a-project')==='/index.html','Deep links load the SPA');
check(destination('/assets/index.js')===undefined,'Static assets are not rewritten to HTML');
await access('api/import.py');check(true,'Native /api/import Python function exists before fallback rewrites');

const dir=await mkdtemp(path.join(os.tmpdir(),'gather-vercel-check-'));
const owner='11111111-1111-4111-8111-111111111111';
Object.assign(process.env,{VERCEL:'1',VERCEL_ENV:'production',VERCEL_URL:'gather-hash.vercel.app',VERCEL_PROJECT_PRODUCTION_URL:'gather.vercel.app',GATHER_MODE:'supabase',APP_ORIGIN:'https://gather.example',SUPABASE_URL:'https://project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test_only',GATHER_OWNER_EMAIL:'medazizgatt@gmail.com',GATHER_DATA_DIR:dir});
const token=[{alg:'HS256',typ:'JWT'},{sub:owner,exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),role:'authenticated'},'test-signature'].map((v,i)=>i===2?v:Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
const user={id:owner,email:'medazizgatt@gmail.com',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ZkAAAAASUVORK5CYII=','base64');
const intents=new Map();const assets=new Map();let imported=false,rangeRequested=false;
const realFetch=globalThis.fetch;
const response=(data,status=200)=>new Response(data===undefined?null:JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
globalThis.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input.url||input);
  const method=options.method||'GET';
  const body=typeof options.body==='string'?JSON.parse(options.body):undefined;
  if(url.origin==='https://gather.example'&&url.pathname==='/api/import'){
    check(new Headers(options.headers).get('authorization')===`Bearer ${token}`,'Background imports forward only the verified owner session');
    imported=true;return response({ok:true});
  }
  if(url.origin!=='https://project.supabase.co')throw new Error('Unexpected external request in test: '+url.origin);
  if(url.pathname==='/auth/v1/token')return response({access_token:token,refresh_token:'test-refresh',expires_in:3600,token_type:'bearer',user});
  if(url.pathname==='/auth/v1/user')return response(user);
  if(url.pathname==='/rest/v1/gather_owner')return response([{user_id:owner}]);
  if(url.pathname==='/rest/v1/gather_items')return response(method==='GET'?[{id:'item',url:'https://example.com/post',tags:[],kind:'link',import_status:'none'}]:undefined,method==='GET'?200:201);
  if(url.pathname==='/rest/v1/gather_uploads'){
    if(method==='POST'){intents.set(body.id,{...body,expected_size:body.expected_size,completed_at:null});return response(undefined,201);}
    const id=url.searchParams.get('id')?.replace('eq.','');
    if(method==='DELETE'){intents.delete(id);return response(undefined,204);}
    return response(intents.has(id)?[intents.get(id)]:[]);
  }
  if(url.pathname.startsWith('/storage/v1/object/upload/sign/'))return response({url:url.pathname.replace('/storage/v1','')+'?token=signed-upload-test'});
  if(url.pathname.startsWith('/storage/v1/object/sign/')){
    if(method==='POST')return response({signedURL:url.pathname.replace('/storage/v1','')+'?token=signed-read-test'});
    rangeRequested=new Headers(options.headers).get('Range')==='bytes=0-65535';
    return new Response(png,{status:206,headers:{'Content-Type':'image/png','Content-Range':`bytes 0-${png.length-1}/${png.length}`}});
  }
  if(url.pathname==='/rest/v1/rpc/gather_finish_upload'){
    const intent=intents.get(body.p_upload_id);check(body.p_mime==='image/png'&&body.p_size===png.length,'Finalization uses verified bytes and actual storage size');
    intent.completed_at=new Date().toISOString();assets.set(intent.id,{...intent,mime:'image/png',size:png.length});return response(intent.id);
  }
  if(url.pathname==='/rest/v1/gather_assets'){
    const id=url.searchParams.get('id')?.replace('eq.','');return response(id&&assets.has(id)?[assets.get(id)]:[]);
  }
  if(url.pathname==='/rest/v1/rpc/gather_prepare_import')return response('22222222-2222-4222-8222-222222222222');
  if(url.pathname==='/rest/v1/rpc/gather_expire_imports')return response(null);
  if(url.pathname.startsWith('/rest/v1/'))return response([]);
  throw new Error('Unexpected SDK request: '+method+' '+url.pathname);
};
const pending=[];
globalThis[Symbol.for('@vercel/request-context')]={get:()=>({waitUntil:promise=>pending.push(promise)})};
const {default:handler}=await import('../api/index.mjs');
const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;let cookie='';
async function request(route,body,method=body===undefined?'GET':'POST',extra={}){
  return new Promise((resolve,reject)=>{
    const req=http.request(base+route,{method,headers:{Host:'gather.example',...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...extra}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{
        const headers=new Headers();for(const [key,value] of Object.entries(res.headers))for(const entry of Array.isArray(value)?value:[value])if(entry!==undefined)headers.append(key,entry);
        resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers}));
      });
    });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
}
try{
  const runtime=await(await request('/api/config')).json();check(runtime.directUploads&&runtime.browserBackup&&runtime.mode==='supabase','Vercel activates direct uploads and browser backups');
  check((await request('/api/state')).status===401,'Vercel state requires authentication');
  check((await request('/api/login',{email:user.email,password:'test-only'},'POST',{Origin:'https://unrelated.example'})).status===403,'Unrelated origins cannot sign in');
  const login=await request('/api/login',{email:user.email,password:'test-only'});check(login.ok,'Cloud login works through the Vercel entry');
  const cookies=login.headers.getSetCookie();cookie=cookies.map(c=>c.split(';')[0]).join('; ');check(cookies.every(c=>c.includes('Secure')&&c.includes('HttpOnly')),'Hosted session cookies are secure and HttpOnly');
  const prepared=await request('/api/items/item/uploads',{name:'A photo.png',size:png.length,mime:'image/png'});const ticket=await prepared.json();
  check(prepared.ok&&ticket.filename.startsWith(owner+'/item/')&&ticket.token,'Upload ticket is scoped to the owner and item');
  const finalized=await request(`/api/items/item/uploads/${ticket.id}/finish`,{});check(finalized.ok&&rangeRequested,'Finalization reads only a signature range, not the full large file');
  const media=await request('/media/'+ticket.id);check(media.status===302&&media.headers.get('location').startsWith('https://project.supabase.co/storage/'),'Large private media redirects to signed storage instead of proxying bytes');
  check((await request('/api/items/item/media',{},'POST')).status===400,'Vercel rejects the old multipart upload path');
  const retry=await request('/api/items/item/import',{});check(retry.ok,'Retry obtains a database import lease');await Promise.all(pending);
  check(imported&&pending.length===1,'Import invocation is registered with waitUntil');
  let localDatabase=false;try{await access(path.join(dir,'gather.sqlite'));localDatabase=true;}catch{}
  check(!localDatabase,'Serverless entry does not open local SQLite');
}finally{
  globalThis.fetch=realFetch;delete globalThis[Symbol.for('@vercel/request-context')];
  await new Promise(resolve=>server.close(resolve));assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(dir,{recursive:true,force:true});
}
console.log(`PASS: ${checks} Vercel routing, auth, direct-upload, private-media, and background-invocation checks.`);
