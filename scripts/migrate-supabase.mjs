import '../server/config.mjs';
import { DatabaseSync } from 'node:sqlite';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { fileTypeFromBuffer } from 'file-type';
import { ownerLogin } from './terminal-login.mjs';
import { result } from '../server/cloud-client.mjs';
import { storageBucket, cloudMaxFileMB as maxFileMB } from '../server/config.mjs';

const directory=process.env.GATHER_DATA_DIR||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'.local','share'),'Gather');
const db=new DatabaseSync(path.join(directory,'gather.sqlite'),{readOnly:true});
try {
  const snapshot={};
  db.exec('BEGIN');
  for(const table of ['items','assets','boards','elements','projects','project_items','project_boards'])snapshot[table]=db.prepare(`SELECT * FROM ${table}`).all();
  db.exec('COMMIT');
  if(snapshot.items.some(item=>['pending','importing'].includes(item.import_status)))throw new Error('Wait for local imports to finish before migrating. Your local collection has not been changed.');
  snapshot.items=snapshot.items.map(i=>({...i,tags:JSON.parse(i.tags),import_status:['pending','importing'].includes(i.import_status)?'failed':i.import_status}));
  for(const asset of snapshot.assets){
    const filename=path.resolve(directory,'media',asset.filename);
    if(!filename.startsWith(path.resolve(directory,'media')+path.sep))throw new Error('Invalid local media path.');
    const info=await stat(filename);
    if(info.size>maxFileMB*1024*1024)throw new Error(`A local file exceeds the configured ${maxFileMB} MB cloud limit. Adjust your Supabase Storage limit and GATHER_MAX_FILE_MB before migrating.`);
    const type=await fileTypeFromBuffer(await readFile(filename));
    if(!type||!/^(image|video)\//.test(type.mime)||type.mime==='image/svg+xml')throw new Error(`Unrecognized media file: ${asset.original_name}`);
  }
  console.log(`Ready to migrate ${snapshot.items.length} references, ${snapshot.assets.length} media files, ${snapshot.boards.length} boards, and ${snapshot.projects.length} projects. Local data will be kept.`);
  const {client,user}=await ownerLogin();
  const counts=await Promise.all(['items','boards','projects'].map(table=>client.from(`gather_${table}`).select('id',{count:'exact',head:true})));
  for(const count of counts)result(count);
  if(counts.some(c=>c.count>0)&&!process.argv.includes('--resume'))throw new Error('Cloud records already exist. This command will not overwrite them. Use --resume only to resume this same local collection migration.');
  const backupDir=path.join(directory,'backups');await mkdir(backupDir,{recursive:true});
  const backup=path.join(backupDir,`before-supabase-migration-${new Date().toISOString().replace(/[:.]/g,'-')}.zip`);
  await promisify(execFile)(process.env.GATHER_PYTHON||'python',[path.resolve(import.meta.dirname,'../server/backup.py'),directory,backup],{windowsHide:true,timeout:600000});
  console.log('Saved a complete local backup before uploading.');
  for(const table of ['items','boards','projects']){
    for(const record of snapshot[table])result(await client.from(`gather_${table}`).upsert({...record,user_id:user.id}));
  }
  for(const asset of snapshot.assets){
    const buffer=await readFile(path.join(directory,'media',asset.filename));
    const type=await fileTypeFromBuffer(buffer);
    if(!type||!/^(image|video)\//.test(type.mime))throw new Error(`Unrecognized media file: ${asset.original_name}`);
    const filename=`${user.id}/${asset.item_id}/${asset.id}.${type.ext}`;
    result(await client.storage.from(storageBucket).upload(filename,buffer,{contentType:type.mime,upsert:true}));
    const stored=result(await client.storage.from(storageBucket).download(filename));
    const digest=data=>createHash('sha256').update(data).digest('hex');
    if(digest(buffer)!==digest(Buffer.from(await stored.arrayBuffer())))throw new Error('A cloud media file did not match the local original. Migration stopped; local files are unchanged.');
    result(await client.from('gather_assets').upsert({...asset,filename,user_id:user.id,source_key:asset.source_key||''}));
    console.log(`Migrated media ${snapshot.assets.indexOf(asset)+1}/${snapshot.assets.length}`);
  }
  for(const table of ['elements','project_items','project_boards'])for(const record of snapshot[table])result(await client.from(`gather_${table}`).upsert({...record,user_id:user.id}));
  for(const table of Object.keys(snapshot)){
    const response=await client.from(`gather_${table}`).select('*',{count:'exact',head:true});result(response);
    if(response.count!==snapshot[table].length)throw new Error(`Cloud ${table} count differs from the local snapshot. Local data has not been removed.`);
  }
  console.log('Migration verified. Local records and files are unchanged. You can now enable GATHER_MODE=supabase.');
  await client.auth.signOut({scope:'local'});
}catch(error){console.error(error.message);process.exitCode=1;}finally{db.close();}
