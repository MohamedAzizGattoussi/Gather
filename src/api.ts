import { uploadFiles } from './cloud-files';
let configuration:Promise<{directUploads?:boolean}>|undefined;

export async function api<T = { ok: boolean }>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  if(body instanceof FormData&&/^\/items\/[^/]+\/media$/.test(path)){
    configuration??=request<{directUploads?:boolean}>('/config');
    if((await configuration).directUploads)return await uploadFiles(request,path.slice(0,-6),body) as T;
  }
  return request<T>(path,body,method);
}
async function request<T = { ok: boolean }>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const result = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : method, headers: body === undefined || body instanceof FormData ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
  let data;
  try{data=await result.json();}catch{throw new Error(result.status===413?'This request is too large. Refresh Gather to use direct file uploads.':'The server returned an unexpected response. Please retry.');}
  if (!result.ok) {
    if (result.status === 401 && path !== '/login' && path !== '/session') window.dispatchEvent(new Event('gather:signout'));
    throw new Error(data.error || 'Something went wrong. Try again.');
  }
  return data;
}
