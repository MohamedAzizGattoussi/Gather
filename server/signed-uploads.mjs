import { randomUUID } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { result } from './cloud-client.mjs';
import { storageBucket, maxFileMB, supabaseUrl } from './config.mjs';

export async function prepareUpload(context,itemId,body){
  const {size,mime}=body||{};
  if(!Number.isSafeInteger(size)||size<=0||size>maxFileMB*1024*1024)throw new Error(`Each file must be between 1 byte and ${maxFileMB} MB.`);
  if(typeof mime!=='string'||!/^(image|video)\/[a-zA-Z0-9.+-]+$/.test(mime)||mime==='image/svg+xml')throw new Error('Choose an image or video file. SVG is not supported.');
  const id=randomUUID(),filename=`${context.user.id}/${itemId}/${id}`;
  result(await context.client.from('gather_uploads').insert({id,item_id:itemId,filename,original_name:typeof body.name==='string'?body.name.slice(0,250):'Uploaded media',expected_size:size}));
  try{
    const signed=result(await context.client.storage.from(storageBucket).createSignedUploadUrl(filename));
    const storageOrigin=new URL(supabaseUrl);
    if(storageOrigin.hostname.endsWith('.supabase.co'))storageOrigin.hostname=storageOrigin.hostname.replace('.supabase.co','.storage.supabase.co');
    return {id,signedUrl:signed.signedUrl,token:signed.token,filename,bucket:storageBucket,endpoint:`${storageOrigin.origin}/storage/v1/upload/resumable`};
  }catch(error){await context.client.from('gather_uploads').delete().eq('id',id);throw error;}
}
export async function finishUpload(context,itemId,uploadId){
  const intent=result(await context.client.from('gather_uploads').select('*').eq('id',uploadId).eq('item_id',itemId).maybeSingle());
  if(!intent)throw new Error('This upload no longer exists.');
  if(intent.completed_at)return intent.id;
  const signed=result(await context.client.storage.from(storageBucket).createSignedUrl(intent.filename,60));
  const response=await fetch(signed.signedUrl,{headers:{Range:'bytes=0-65535'},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error('The file has not finished uploading. Try again.');
  const range=response.headers.get('content-range');
  const size=range?Number(range.split('/').at(-1)):Number(response.headers.get('content-length'));
  const reader=response.body.getReader();const chunks=[];let total=0;
  try{while(total<65536){const {done,value}=await reader.read();if(done)break;const chunk=value.slice(0,65536-total);chunks.push(Buffer.from(chunk));total+=chunk.length;}}finally{await reader.cancel();}
  const type=await fileTypeFromBuffer(Buffer.concat(chunks));
  if(size!==Number(intent.expected_size)||!type||!/^(image|video)\//.test(type.mime)||type.mime==='image/svg+xml')throw new Error('The uploaded file is incomplete or is not a supported image/video.');
  return result(await context.client.rpc('gather_finish_upload',{p_upload_id:uploadId,p_mime:type.mime,p_size:size}));
}
export async function cancelUpload(context,itemId,uploadId){
  const intent=result(await context.client.from('gather_uploads').select('*').eq('id',uploadId).eq('item_id',itemId).maybeSingle());
  if(!intent||intent.completed_at)return;
  await context.client.storage.from(storageBucket).remove([intent.filename]);
  result(await context.client.from('gather_uploads').delete().eq('id',uploadId));
}
