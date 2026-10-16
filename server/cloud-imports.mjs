import { randomUUID } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { clientFor, result } from './cloud-client.mjs';
import { storageBucket, maxFileMB } from './config.mjs';
import { discover, fetchPublic, validUrl } from './source-resolver.mjs';

export const activeImports = new Set();
const queue = [];
let working = false;

export async function cloudStoreMedia(client, ownerId, itemId, buffer, name, source = '', sourceKey = '') {
  if (buffer.length > maxFileMB * 1024 * 1024) throw new Error(`Each cloud file can be up to ${maxFileMB} MB. Check your Supabase Storage limit before increasing this.`);
  const type = await fileTypeFromBuffer(buffer);
  if (!type || !/^(image|video)\//.test(type.mime) || type.mime === 'image/svg+xml') throw new Error('Use a recognized image or video file. SVG is not supported.');
  const item = result(await client.from('gather_items').select('id').eq('id',itemId).maybeSingle());
  if (!item) throw new Error('This reference no longer exists.');
  const id = randomUUID(), filename = `${ownerId}/${itemId}/${id}.${type.ext}`;
  result(await client.storage.from(storageBucket).upload(filename, buffer, { contentType: type.mime, upsert: false }));
  try {
    const last = result(await client.from('gather_assets').select('position').eq('item_id',itemId).order('position',{ascending:false}).limit(1));
    result(await client.from('gather_assets').insert({ id, item_id:itemId, filename, mime:type.mime, original_name:name, source, source_key:sourceKey, position:(last[0]?.position ?? -1)+1, size:buffer.length }));
  } catch(e) { await client.storage.from(storageBucket).remove([filename]); throw e; }
  await updateKind(client,itemId);
  return id;
}
async function updateKind(client,itemId) {
  const assets = result(await client.from('gather_assets').select('mime').eq('item_id',itemId).order('position'));
  result(await client.from('gather_items').update({kind:assets.length>1?'carousel':assets[0]?.mime.startsWith('video/')?'video':assets.length?'image':'link'}).eq('id',itemId));
}
export async function enqueueCloudImport(context, item) {
  validUrl(item.url);
  if (activeImports.has(item.id)) return;
  activeImports.add(item.id);
  try { result(await context.client.from('gather_items').update({import_status:'pending',import_message:''}).eq('id',item.id)); }
  catch(error) { activeImports.delete(item.id); throw error; }
  queue.push({accessToken:context.accessToken, ownerId:context.user.id, item});
  drain();
}
async function drain() {
  if (working) return;
  working=true;
  try { while(queue.length) await perform(queue.shift()); } finally { working=false; }
}
async function perform({accessToken,ownerId,item}) {
  const client=clientFor(accessToken);
  let saved=0,failed=0; const imported=[];
  try {
    const expires=JSON.parse(Buffer.from(accessToken.split('.')[1],'base64url').toString()).exp*1000;
    if (expires-Date.now()<120000) throw new Error('Sign in again and retry this import.');
    result(await client.from('gather_items').update({import_status:'importing',import_message:''}).eq('id',item.id));
    const found=await discover(item.url);
    for (const slide of found.media) {
      if (expires-Date.now()<60000) throw new Error('Your session needs refreshing. Sign in again and retry; downloaded slides are kept.');
      const assets=result(await client.from('gather_assets').select('id,source,source_key').eq('item_id',item.id));
      const existing=assets.find(a=>(a.source_key && a.source_key===slide.key)||a.source===slide.url);
      if(existing){imported.push(existing.id);saved++;continue;}
      try {
        const response=found.direct||await fetchPublic(slide.url,maxFileMB*1024*1024);
        imported.push(await cloudStoreMedia(client,ownerId,item.id,response.buffer,`Slide ${saved+1}`,slide.url,slide.key));saved++;
      } catch {failed++;}
    }
    const partial=failed>0||found.uncertain||saved!==found.expected;
    if(saved&&!partial){
      const assets=result(await client.from('gather_assets').select('id,source,filename').eq('item_id',item.id).order('position'));
      const obsolete=assets.filter(a=>a.source&&!imported.includes(a.id));
      if(obsolete.length) result(await client.from('gather_assets').delete().in('id',obsolete.map(a=>a.id)));
      const ids=[...imported,...assets.filter(a=>!a.source&&!imported.includes(a.id)).map(a=>a.id)];
      result(await client.rpc('gather_order_assets',{p_item_id:item.id,p_ids:ids}));
      // Retain obsolete storage objects for backup consistency; they are no longer
      // referenced in the collection and remain private under the same owner policy.
      await updateKind(client,item.id);
    }
    result(await client.from('gather_items').update({import_status:saved?(partial?'partial':'complete'):'failed',import_message:saved?(partial?`${saved} files stored. Check the source for missing slides; you can attach them manually.`:`${saved} files stored privately in your Gather collection.`):'The source did not expose downloadable media. Your link is saved; attach files manually.'}).eq('id',item.id));
  }catch(e){await client.from('gather_items').update({import_status:'failed',import_message:String(e.message).slice(0,500)}).eq('id',item.id);}
  finally{activeImports.delete(item.id);}
}
