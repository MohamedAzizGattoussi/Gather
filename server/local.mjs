import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { unlink } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dataDir, mediaDir, tempDir, db, all, get, run, id, now, state, checkPassword, hashPassword } from './db.mjs';
import { enqueueImport, validUrl, storeMedia } from './imports.mjs';
export const localRouter = express.Router();
let exporting = false;
const tokenHash = token => createHash('sha256').update(token).digest('hex');
function token(req) { return (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith('gather_session='))?.slice(15) || ''; }
function authenticated(req) { const raw = token(req); return raw && get('SELECT token FROM sessions WHERE token=? AND expires>?', tokenHash(raw), Date.now()); }
localRouter.get('/api/session', (req, res) => res.json({ authenticated: !!authenticated(req) }));
let attempts = [];
localRouter.post('/api/login', (req, res) => {
  attempts = attempts.filter(t => t > Date.now() - 60000);
  if (attempts.length >= 12) return res.status(429).json({ error: 'A few too many attempts. Try again in a minute.' });
  const password = req.body?.password;
  attempts.push(Date.now());
  if (typeof password !== 'string' || password.length > 1024 || !checkPassword(password)) return res.status(401).json({ error: 'That password doesn’t match. Try again.' });
  attempts = [];
  const value = randomBytes(32).toString('hex');
  run('DELETE FROM sessions WHERE expires<?', Date.now());
  run('INSERT INTO sessions VALUES (?,?)', tokenHash(value), Date.now() + 7 * 86400000);
  res.setHeader('Set-Cookie', `gather_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`);
  res.json({ ok: true });
});
localRouter.use(['/api', '/media'], (req, res, next) => {
  if (!authenticated(req)) return res.status(401).json({ error: 'Sign in to open your Gather library.' });
  if (exporting && !['GET', 'HEAD'].includes(req.method)) return res.status(409).json({ error: 'A backup is being prepared. Try again when it finishes.' });
  next();
});
localRouter.post('/api/logout', (req, res) => {
  run('DELETE FROM sessions WHERE token=?', tokenHash(token(req)));
  res.setHeader('Set-Cookie', 'gather_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});
localRouter.get('/api/state', (req, res) => res.json(state()));
const text = (value, max = 20000) => typeof value === 'string' ? value.slice(0, max).trim() : '';
const title = value => text(value, 240);
const tags = value => JSON.stringify([...new Set((Array.isArray(value) ? value : []).filter(t => typeof t === 'string').map(t => t.trim().slice(0, 80)).filter(Boolean))].slice(0, 50));
const requireItem = itemId => { const item = get('SELECT * FROM items WHERE id=?', itemId); if (!item) throw Object.assign(new Error('This item no longer exists.'), { status: 404 }); return item; };
localRouter.post('/api/items', (req, res) => {
  const body = req.body || {};
  const url = text(body.url, 4000);
  if (url) validUrl(url);
  if (!url && !text(body.note) && !body.hasFiles) return res.status(400).json({ error: 'Add a link, a note, or a file first.' });
  const itemId = id();
  run('INSERT INTO items (id,title,url,note,category,tags,created,kind) VALUES (?,?,?,?,?,?,?,?)', itemId, title(body.title), url, text(body.note), text(body.category, 80), tags(body.tags), now(), url ? 'link' : 'note');
  if (url && body.import !== false) enqueueImport(itemId);
  res.status(201).json({ id: itemId });
});
localRouter.patch('/api/items/:id', (req, res) => {
  const item = requireItem(req.params.id); const body = req.body || {};
  const url = body.url === undefined ? item.url : text(body.url, 4000);
  if (url) validUrl(url);
  run('UPDATE items SET title=?,url=?,note=?,category=?,tags=? WHERE id=?', body.title === undefined ? item.title : title(body.title), url, body.note === undefined ? item.note : text(body.note), body.category === undefined ? item.category : text(body.category, 80), body.tags === undefined ? item.tags : tags(body.tags), item.id);
  res.json({ ok: true });
});
localRouter.delete('/api/items/:id', async (req, res) => {
  requireItem(req.params.id);
  const assets = all('SELECT filename FROM assets WHERE item_id=?', req.params.id);
  run('DELETE FROM items WHERE id=?', req.params.id);
  await Promise.all(assets.map(a => unlink(path.join(mediaDir, a.filename)).catch(() => {})));
  res.json({ ok: true });
});
const upload = multer({ dest: tempDir, limits: { fileSize: 150 * 1024 * 1024, files: 40, fields: 4 } });
localRouter.post('/api/items/:id/media', (req, res, next) => {
  try { requireItem(req.params.id); next(); } catch(e) { next(e); }
}, upload.array('files', 40), async (req, res) => {
  const files = req.files || []; let saved = 0;
  try {
    if (!files.length) return res.status(400).json({ error: 'Choose image or video files to attach.' });
    for (const file of files) { await storeMedia(req.params.id, file.path, file.originalname); saved++; }
    res.json({ ok: true, saved });
  } catch (e) { res.status(400).json({ error: `${saved ? `${saved} file(s) saved. ` : ''}${e.message}` }); }
  finally { await Promise.all(files.map(f => unlink(f.path).catch(() => {}))); }
});
localRouter.patch('/api/items/:id/media-order', (req, res) => {
  requireItem(req.params.id);
  const existing = all('SELECT id FROM assets WHERE item_id=?', req.params.id).map(a => a.id);
  const ordered = req.body.ids;
  if (!Array.isArray(ordered) || ordered.length !== existing.length || new Set(ordered).size !== existing.length || ordered.some(a => !existing.includes(a))) return res.status(400).json({ error: 'The slide list has changed. Reopen the item and try again.' });
  db.exec('BEGIN');
  try { ordered.forEach((assetId, i) => run('UPDATE assets SET position=? WHERE id=? AND item_id=?', i, assetId, req.params.id)); db.exec('COMMIT'); } catch(e) { db.exec('ROLLBACK'); throw e; }
  res.json({ ok: true });
});
localRouter.post('/api/items/:id/import', (req, res) => { const item = requireItem(req.params.id); if (!item.url) return res.status(400).json({ error: 'Add a source link first.' }); enqueueImport(item.id); res.json({ ok: true }); });
localRouter.get('/media/:id', (req, res) => {
  const asset = get('SELECT * FROM assets WHERE id=?', req.params.id);
  if (!asset) return res.sendStatus(404);
  res.type(asset.mime).sendFile(path.join(mediaDir, asset.filename));
});

for (const type of ['boards', 'projects']) {
  localRouter.post(`/api/${type}`, (req, res) => {
    const name = title(req.body?.title);
    if (!name) return res.status(400).json({ error: 'Give it a name first.' });
    const entryId = id();
    run(`INSERT INTO ${type} (id,title,created) VALUES (?,?,?)`, entryId, name, now());
    res.status(201).json({ id: entryId });
  });
  localRouter.patch(`/api/${type}/:id`, (req, res) => {
    const entry = get(`SELECT * FROM ${type} WHERE id=?`, req.params.id);
    if (!entry) return res.status(404).json({ error: 'This workspace no longer exists.' });
    const name = req.body.title === undefined ? entry.title : title(req.body.title);
    if (!name) return res.status(400).json({ error: 'Give it a name first.' });
    run(`UPDATE ${type} SET title=?,description=?${type === 'projects' ? ',notes=?' : ''} WHERE id=?`, name, req.body.description === undefined ? entry.description : text(req.body.description), ...(type === 'projects' ? [req.body.notes === undefined ? entry.notes : text(req.body.notes, 100000)] : []), entry.id);
    res.json({ ok: true });
  });
  localRouter.delete(`/api/${type}/:id`, (req, res) => { run(`DELETE FROM ${type} WHERE id=?`, req.params.id); res.json({ ok: true }); });
}
localRouter.put('/api/boards/:id/elements', (req, res) => {
  const board = get('SELECT * FROM boards WHERE id=?', req.params.id);
  if (!board) return res.status(404).json({ error: 'This board no longer exists.' });
  if (req.body.revision !== board.revision) return res.status(409).json({ error: 'This board changed in another window. Reopen it before editing.' });
  const elements = req.body.elements;
  if (!Array.isArray(elements) || elements.length > 1000) return res.status(400).json({ error: 'Board is too large.' });
  const elementIds = new Set();
  for (const e of elements) {
    if (typeof e.id !== 'string' || e.id.length > 80 || elementIds.has(e.id) || [e.x,e.y,e.width,e.height,e.z].some(n => !Number.isFinite(n) || Math.abs(n) > 100000) || e.width < 120 || e.height < 80 || (e.item_id && !get('SELECT id FROM items WHERE id=?', e.item_id))) return res.status(400).json({ error: 'Invalid board element. Reopen the board and try again.' });
    elementIds.add(e.id);
  }
  db.exec('BEGIN');
  try {
    run('DELETE FROM elements WHERE board_id=?', board.id);
    for (const e of elements) run('INSERT INTO elements VALUES (?,?,?,?,?,?,?,?,?,?)', e.id, board.id, e.item_id || null, text(e.text), e.x, e.y, e.width, e.height, Math.round(e.z), ['paper','sand','sage','rose'].includes(e.color) ? e.color : 'paper');
    run('UPDATE boards SET revision=revision+1 WHERE id=?', board.id);
    db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK'); throw e; }
  res.json({ revision: board.revision + 1 });
});
localRouter.put('/api/projects/:id/links', (req, res) => {
  if (!get('SELECT id FROM projects WHERE id=?', req.params.id)) return res.status(404).json({ error: 'Project not found.' });
  const { itemIds, boardIds } = req.body;
  if (!Array.isArray(itemIds) || !Array.isArray(boardIds) || itemIds.length + boardIds.length > 5000 || itemIds.some(i => typeof i !== 'string' || !get('SELECT id FROM items WHERE id=?', i)) || boardIds.some(i => typeof i !== 'string' || !get('SELECT id FROM boards WHERE id=?', i))) return res.status(400).json({ error: 'Invalid project links.' });
  db.exec('BEGIN');
  try {
    run('DELETE FROM project_items WHERE project_id=?', req.params.id);
    run('DELETE FROM project_boards WHERE project_id=?', req.params.id);
    [...new Set(itemIds)].forEach(i => run('INSERT INTO project_items VALUES (?,?)', req.params.id, i));
    [...new Set(boardIds)].forEach(i => run('INSERT INTO project_boards VALUES (?,?)', req.params.id, i));
    db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK'); throw e; }
  res.json({ ok: true });
});
localRouter.post('/api/password', (req, res) => {
  const { current, password } = req.body || {};
  if (typeof current !== 'string' || current.length > 1024 || !checkPassword(current)) return res.status(400).json({ error: 'Current password does not match.' });
  if (typeof password !== 'string' || password.length < 8 || password.length > 1024) return res.status(400).json({ error: 'Use a password of at least 8 characters.' });
  run('UPDATE settings SET value=? WHERE key=?', hashPassword(password), 'password');
  run('DELETE FROM sessions WHERE token<>?', tokenHash(token(req)));
  res.json({ ok: true });
});
localRouter.get('/api/settings', (req, res) => res.json({ dataDir, maxFileMB: 150 }));
localRouter.get('/api/backup', async (req, res) => {
  if (exporting) return res.status(409).json({ error: 'A backup is already being prepared.' });
  exporting = true;
  const file = path.join(tempDir, `gather-backup-${id()}.zip`);
  try {
    await promisify(execFile)(process.env.GATHER_PYTHON || 'python', [path.join(import.meta.dirname, 'backup.py'), dataDir, file], { timeout: 600000, windowsHide: true });
    res.download(file, `Gather-backup-${new Date().toISOString().slice(0,10)}.zip`, async () => { exporting = false; await unlink(file).catch(() => {}); });
  } catch { exporting = false; await unlink(file).catch(() => {}); res.status(500).json({ error: 'Backup could not be prepared. Check free disk space and Python availability.' }); }
});
localRouter.use('/api', (req,res) => res.status(404).json({ error: 'This action was not found.' }));
localRouter.use((error, req, res, next) => {
  if (req.files) Promise.all(req.files.map(f => unlink(f.path).catch(() => {}))).catch(() => {});
  console.error(error.message);
  if (res.headersSent) return next(error);
  res.status(error.status || 400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Each file can be up to 150 MB.' : error.message || 'Something went wrong. Please try again.' });
});

