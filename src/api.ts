export async function api<T = { ok: boolean }>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const result = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : method, headers: body === undefined || body instanceof FormData ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
  const data = await result.json();
  if (!result.ok) {
    if (result.status === 401 && path !== '/login' && path !== '/session') window.dispatchEvent(new Event('gather:signout'));
    throw new Error(data.error || 'Something went wrong. Try again.');
  }
  return data;
}
