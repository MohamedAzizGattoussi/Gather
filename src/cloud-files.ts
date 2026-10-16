import { Upload } from 'tus-js-client';
import { downloadZip } from 'client-zip';

export type UploadTicket={id:string;signedUrl:string;token:string;filename:string;bucket:string;endpoint:string};
type Request=<T>(path:string,body?:unknown,method?:string)=>Promise<T>;

export function fileMime(file:File){
  if(file.type&&/^(image|video)\//.test(file.type))return file.type;
  const extensions:Record<string,string>={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',avif:'image/avif',heic:'image/heic',heif:'image/heif',tif:'image/tiff',tiff:'image/tiff',bmp:'image/bmp',mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm',mkv:'video/x-matroska',avi:'video/x-msvideo'};
  return extensions[file.name.split('.').at(-1)?.toLowerCase()||'']||'';
}
export async function uploadFiles(request:Request,itemPath:string,form:FormData){
  const files=form.getAll('files').filter((file):file is File=>file instanceof File);
  if(!files.length||files.length>40)throw new Error('Choose between 1 and 40 image/video files.');
  let saved=0;
  for(const file of files){
    const ticket=await request<UploadTicket>(`${itemPath}/uploads`,{name:file.name,size:file.size,mime:fileMime(file)});
    try{
      if(file.size>6*1024*1024){
        await new Promise<void>((resolve,reject)=>{
          const upload=new Upload(file,{endpoint:ticket.endpoint,headers:{'x-signature':ticket.token},metadata:{bucketName:ticket.bucket,objectName:ticket.filename,contentType:fileMime(file),cacheControl:'3600'},chunkSize:6*1024*1024,retryDelays:[0,1000,3000,5000,10000],uploadDataDuringCreation:true,storeFingerprintForResuming:false,removeFingerprintOnSuccess:true,onError:reject,onSuccess:()=>resolve()});
          upload.start();
        });
      }else{
        const data=new FormData();data.append('cacheControl','3600');data.append('',file);
        const response=await fetch(ticket.signedUrl,{method:'PUT',headers:{'x-upsert':'false'},body:data,credentials:'omit',referrerPolicy:'no-referrer'});
        if(!response.ok)throw new Error('The file could not be uploaded to private storage. Please retry.');
      }
      await request(`${itemPath}/uploads/${ticket.id}/finish`,{});saved++;
    }catch(error){
      await request(`${itemPath}/uploads/${ticket.id}`,{},'DELETE').catch(()=>{});
      throw new Error(`${saved?`${saved} files saved. `:''}${(error as Error).message}`);
    }
  }
  return{ok:true,saved};
}

type SaveWindow=Window&{showSaveFilePicker?:(options:unknown)=>Promise<{createWritable:()=>Promise<WritableStream<Uint8Array>>}>};
export async function downloadBackup(browserBackup:boolean,request:Request){
  if(!browserBackup){window.location.assign('/api/backup');return;}
  const filename=`Gather-cloud-backup-${new Date().toISOString().slice(0,10)}.zip`;
  const saveWindow=window as SaveWindow;
  let writable:WritableStream<Uint8Array>|undefined;
  const abort=new AbortController();
  try{
    // Request the file destination while the original button click is still active.
    if(saveWindow.showSaveFilePicker){const handle=await saveWindow.showSaveFilePicker({suggestedName:filename,types:[{description:'Gather backup',accept:{'application/zip':['.zip']}}]});writable=await handle.createWritable();}
    const manifest=await request<{snapshot:unknown;media:{id:string;size:number;url:string}[]}>('/backup-manifest');
    async function* entries(){
      yield{name:'gather.json',input:JSON.stringify(manifest.snapshot,null,2)};
      yield{name:'RESTORE.txt',input:'Private Gather cloud backup. Restore into a configured empty project with: npm run restore:supabase -- <archive.zip>. Keep this archive safe.\n'};
      for(const file of manifest.media){
        const response=await fetch(file.url,{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:abort.signal});
        if(!response.ok||!response.body)throw new Error('A media file could not be backed up. Please retry.');
        let received=0;
        const verified=response.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){received+=chunk.length;controller.enqueue(chunk);},flush(){if(received!==file.size)throw new Error('A media file was incomplete. The backup was not saved.');}}));
        yield{name:`media/${file.id}`,input:verified,size:file.size};
      }
    }
    const zipped=downloadZip(entries());
    if(writable){await zipped.body!.pipeTo(writable);writable=undefined;}
    else{const blob=await zipped.blob();const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  }catch(error){if(writable)await writable.abort().catch(()=>{});if((error as Error).name!=='AbortError')throw error;}
  finally{abort.abort();}
}
