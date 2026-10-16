import '../server/config.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { ownerLogin } from './terminal-login.mjs';
import { result } from '../server/cloud-client.mjs';
import { storageBucket, cloudMaxFileMB as maxFileMB } from '../server/config.mjs';

if(!process.argv[2])throw new Error('Usage: npm run restore:supabase -- <Gather-cloud-backup.zip>');
const temp=await mkdtemp(path.join(os.tmpdir(),'gather-restore-'));
try{
  await promisify(execFile)(process.env.GATHER_PYTHON||'python',[path.resolve('server/unpack-backup.py'),path.resolve(process.argv[2]),temp],{windowsHide:true,maxBuffer:1024*1024});
  const snapshot=JSON.parse(await readFile(path.join(temp,'gather.json'),'utf8'));
  const{client,user}=await ownerLogin();
  for(const table of ['items','boards','projects']){
    const response=await client.from(`gather_${table}`).select('id',{count:'exact',head:true});result(response);
    if(response.count>0)throw new Error('Restore requires an empty Gather cloud collection. Existing content has not been modified.');
  }
  for(const table of ['items','boards','projects'])for(const record of snapshot[table])result(await client.from(`gather_${table}`).insert({...record,user_id:user.id,import_status:table==='items'&&['pending','importing'].includes(record.import_status)?'failed':record.import_status}));
  for(const asset of snapshot.assets){
    const buffer=await readFile(path.join(temp,asset.id));const type=await fileTypeFromBuffer(buffer);
    if(buffer.length>maxFileMB*1024*1024||!type||!/^(image|video)\//.test(type.mime))throw new Error('Backup media is unsupported or exceeds the cloud upload limit.');
    const filename=`${user.id}/${asset.item_id}/${asset.id}.${type.ext}`;
    result(await client.storage.from(storageBucket).upload(filename,buffer,{contentType:type.mime,upsert:false}));
    result(await client.from('gather_assets').insert({...asset,filename,user_id:user.id}));
  }
  for(const table of ['elements','project_items','project_boards'])for(const record of snapshot[table])result(await client.from(`gather_${table}`).insert({...record,user_id:user.id}));
  console.log('Cloud backup restored. Keep your original archive.');await client.auth.signOut({scope:'local'});
}catch(error){console.error(error.message);process.exitCode=1;}
finally{if(!path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep))throw new Error('Invalid temporary restore path');await rm(temp,{recursive:true,force:true});}
