// End-to-end local API checks run against disposable data, never the owner's library.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { navigationFor } from '../src/navigation.ts';
import { extractorMedia, pageMedia } from '../server/media-discovery.mjs';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const dir = await mkdtemp(path.join(os.tmpdir(), 'gather-check-'));
const server = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, GATHER_MODE: 'local', APP_ORIGIN: '', GATHER_DATA_DIR: dir, PORT: '4318', GATHER_INITIAL_PASSWORD: '123456789' }, stdio: ['ignore','pipe','pipe'], windowsHide: true });
let output = '', cookie = '', checks = 0;
server.stdout.on('data', chunk => { output += chunk; });
server.stderr.on('data', chunk => { output += chunk; });
const base = 'http://127.0.0.1:4318';
const check = (condition, message) => { assert.ok(condition, message); checks++; };
async function request(route, body, method = body === undefined ? 'GET' : 'POST', signedIn = true) {
  const response = await fetch(base + route, { method, headers: { ...(signedIn ? { Cookie: cookie } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
  let data; try { data = await response.json(); } catch { /* Some routes return binary media. */ }
  return { response, data };
}
const state = async () => (await request('/api/state')).data;
const create = async (route, body) => (await request(route, body)).data.id;
try {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' });
  try {
    const { MediaSlider } = await vite.ssrLoadModule('/src/MediaSlider.tsx');
    const slides = Array.from({ length: 7 }, (_, i) => ({ id: `slide-${i + 1}`, mime: 'image/jpeg', original_name: `Slide ${i + 1}`, position: i, size: 100 }));
    const detail = renderToStaticMarkup(createElement(MediaSlider, { assets: slides, title: 'Instagram carousel' }));
    check(detail.includes('Previous slide') && detail.includes('Next slide') && detail.includes('Go to slide 7') && detail.includes('1 / 7'), 'Detail carousel renders arrows, counter, and every slide thumbnail');
    const card = renderToStaticMarkup(createElement(MediaSlider, { assets: slides, compact: true, onOpen: () => {} }));
    check(card.includes('Next slide') && card.includes('Go to slide 7') && card.includes('slider-open'), 'Library carousel renders independently usable slide controls and detail opener');
    check(renderToStaticMarkup(createElement(MediaSlider, { assets: [] })) === '', 'An empty carousel does not crash rendering');
  } finally { await vite.close(); }
  const carousel = extractorMedia({ expected_count: 7, gather_media: Array.from({ length: 7 }, (_, i) => ({ url: `https://cdn.example.com/${i + 1}.jpg`, key: `instagram:slide-${i + 1}`, kind: 'image' })) }, 'https://www.instagram.com/p/example/');
  check(carousel.media.length === 7 && !carousel.uncertain && carousel.media[6].key === 'instagram:slide-7', 'Image-only Instagram carousel retains every slide in order');
  const partial = extractorMedia({ expected_count: 3, gather_media: [{ url: 'https://cdn.example.com/1.jpg', kind: 'image' }, { url: null }, { url: 'https://cdn.example.com/3.mp4', kind: 'video' }] }, 'https://example.com/post');
  check(partial.uncertain && partial.expected === 3 && partial.media.length === 2, 'Missing carousel slides remain a partial import');
  const gallery = pageMedia('<meta property="og:image" content="/cover.jpg"><div class="swiper"><img src="/small.jpg" srcset="/small.jpg 300w, /one.jpg 1200w"><img data-src="/two.jpg"><video src="/three.mp4"></video><img src="/two.jpg"></div>', 'https://example.com/post');
  check(gallery.media.map(slide => slide.url).join(',') === 'https://example.com/one.jpg,https://example.com/two.jpg,https://example.com/three.mp4' && !gallery.uncertain, 'Website carousel prefers full-size ordered slides over one Open Graph cover');
  const schema = pageMedia('<script type="application/ld+json">{"@type":"ImageGallery","image":["/first.jpg","/second.jpg","/third.jpg"]}</script>', 'https://example.com/gallery');
  check(schema.media.length === 3 && schema.media[1].url.endsWith('/second.jpg'), 'Structured website galleries retain all images');
  const cover = pageMedia('<meta property="og:image" content="/cover.jpg">', 'https://example.com/post');
  check(cover.media.length === 1 && cover.uncertain, 'A cover alone is not counted as a complete carousel');
  const emptyNav = navigationFor({ items: [], boards: [], projects: [] });
  check(emptyNav.every(link => link.count === 0), 'Sidebar renders empty collections without a missing Library lookup');
  const populatedNav = navigationFor({ items: [{}, {}], boards: [{}], projects: [{}, {}, {}] });
  check(populatedNav.map(link => link.count).join(',') === '2,1,3', 'Sidebar maps Library to items and each workspace to its own collection');
  for (let i = 0; i < 100 && !output.includes('Gather is ready'); i++) await new Promise(resolve => setTimeout(resolve, 100));
  check(output.includes('Gather is ready'), 'Local server starts');
  check((await request('/api/state', undefined, 'GET', false)).response.status === 401, 'Private state requires login');
  check((await request('/api/login', { password: 'wrong' })).response.status === 401, 'Wrong password rejected');
  const login = await request('/api/login', { password: '123456789' });
  check(login.response.ok, 'Initial password works');
  cookie = login.response.headers.get('set-cookie').split(';')[0];
  const idea = await create('/api/items', { note: 'Warm materials', title: 'A passing thought' });
  check(!!idea, 'Idea saves without organization');
  const reference = await create('/api/items', { url: 'https://example.com/reference', title: 'A reference', import: false });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ZkAAAAASUVORK5CYII=', 'base64');
  const form = new FormData();
  form.append('files', new Blob([png], { type: 'image/png' }), 'first.png');
  form.append('files', new Blob([png], { type: 'image/png' }), 'second.png');
  check((await request(`/api/items/${reference}/media`, form)).response.ok, 'Carousel upload works');
  let saved = (await state()).items.find(item => item.id === reference);
  check(saved.assets.length === 2 && saved.kind === 'carousel' && saved.url === 'https://example.com/reference', 'Media and original source persist together');
  check((await request('/media/' + saved.assets[0].id, undefined, 'GET', false)).response.status === 401, 'Stored media requires login');
  const media = await fetch(base + '/media/' + saved.assets[0].id, { headers: { Cookie: cookie, Range: 'bytes=0-15' } });
  check(media.status === 206 && (await media.arrayBuffer()).byteLength === 16, 'Private media supports ranged delivery');
  const order = saved.assets.map(asset => asset.id).reverse();
  check((await request(`/api/items/${reference}/media-order`, { ids: order }, 'PATCH')).response.ok, 'Carousel order is editable');
  saved = (await state()).items.find(item => item.id === reference);
  check(saved.assets[0].id === order[0], 'Carousel order persists');
  const invalid = new FormData(); invalid.append('files', new Blob(['not an image'], { type: 'image/png' }), 'fake.png');
  check((await request(`/api/items/${reference}/media`, invalid)).response.status === 400, 'File signatures are validated');
  const board = await create('/api/boards', { title: 'Warm spaces' });
  const element = { id: 'reference-placement', item_id: reference, text: '', x: 30, y: 40, width: 240, height: 280, z: 1, color: 'paper' };
  const note = { ...element, id: 'local-note', item_id: null, text: 'Focus on texture', x: 310, width: 200, height: 160, z: 2, color: 'sand' };
  const canvas = await request(`/api/boards/${board}/elements`, { revision: 0, elements: [element, note] }, 'PUT');
  check(canvas.response.ok && canvas.data.revision === 1, 'Canvas persists reference and independent note');
  check((await request(`/api/boards/${board}/elements`, { revision: 0, elements: [] }, 'PUT')).response.status === 409, 'Stale canvas revisions cannot overwrite changes');
  const project = await create('/api/projects', { title: 'A quiet room' });
  const other = await create('/api/projects', { title: 'Another direction' });
  check((await request(`/api/projects/${project}/links`, { itemIds: [idea, reference], boardIds: [board] }, 'PUT')).response.ok, 'Direct project references and boards link independently');
  await request(`/api/projects/${other}/links`, { itemIds: [], boardIds: [board] }, 'PUT');
  let current = await state();
  check(current.boards[0].projectIds.length === 2, 'One board can serve multiple projects');
  check(current.items.length === 2, 'Linked items remain in Library');
  check((await request(`/api/projects/${project}`, { notes: 'A longer exploration', description: 'A materials study' }, 'PATCH')).response.ok, 'Project notes save');
  check((await state()).projects.find(p => p.id === project).notes === 'A longer exploration', 'Project notes persist');
  check((await request('/api/items', { url: 'http://127.0.0.1/private' })).response.status === 400, 'Private-address imports rejected');
  const origin = await fetch(base + '/api/items', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://unrelated.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ note: 'Should not save' }) });
  check(origin.status === 403, 'Cross-origin mutation rejected');
  const backup = await fetch(base + '/api/backup', { headers: { Cookie: cookie } });
  check(backup.ok && backup.headers.get('content-disposition').includes('.zip'), 'Backup downloads a ZIP');
  const archive = Buffer.from(await backup.arrayBuffer());
  check(archive.subarray(0, 2).toString() === 'PK', 'Backup archive signature is valid');
  check(archive.includes(Buffer.from('media/')) && archive.includes(Buffer.from('gather.sqlite')) && archive.includes(Buffer.from('RESTORE.txt')), 'Backup includes database, media, and restore instructions');
  await request(`/api/projects/${project}`, {}, 'DELETE');
  current = await state();
  check(current.items.length === 2 && current.boards.length === 1 && current.boards[0].projectIds.length === 1, 'Deleting project preserves shared board and Library items');
  await request(`/api/items/${reference}`, {}, 'DELETE');
  current = await state();
  check(current.items.length === 1 && current.boards[0].elements.length === 1 && current.boards[0].elements[0].text === note.text, 'Deleting item removes placements but preserves local notes');
  await request('/api/logout', {});
  check((await request('/api/state')).response.status === 401, 'Locking Gather invalidates the session');
  console.log(`PASS: ${checks} integration checks with isolated temporary data.`);
} catch (error) {
  console.error(error); console.error(output); process.exitCode = 1;
} finally {
  server.kill();
  if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve));
  // mkdtemp returns an absolute child of the OS temp directory; never remove project or owner data.
  assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
  await rm(dir, { recursive: true, force: true });
}
