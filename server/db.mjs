import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scryptSync, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';

export const dataDir = process.env.GATHER_DATA_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'Gather');
export const mediaDir = path.join(dataDir, 'media');
export const tempDir = path.join(dataDir, 'temporary');
mkdirSync(mediaDir, { recursive: true });
mkdirSync(tempDir, { recursive: true });
export const db = new DatabaseSync(path.join(dataDir, 'gather.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', created TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'link', import_status TEXT NOT NULL DEFAULT 'none', import_message TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE, filename TEXT NOT NULL, mime TEXT NOT NULL, original_name TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL, size INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS elements (id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE, item_id TEXT REFERENCES items(id) ON DELETE CASCADE, text TEXT NOT NULL DEFAULT '', x REAL NOT NULL, y REAL NOT NULL, width REAL NOT NULL, height REAL NOT NULL, z INTEGER NOT NULL, color TEXT NOT NULL DEFAULT 'paper');
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS project_items (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE, PRIMARY KEY(project_id,item_id));
CREATE TABLE IF NOT EXISTS project_boards (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE, PRIMARY KEY(project_id,board_id));`);

if (!db.prepare('PRAGMA table_info(assets)').all().some(column => column.name === 'source_key')) {
  db.exec("ALTER TABLE assets ADD COLUMN source_key TEXT NOT NULL DEFAULT ''");
}

export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const all = (sql, ...args) => db.prepare(sql).all(...args);
export const get = (sql, ...args) => db.prepare(sql).get(...args);
export const run = (sql, ...args) => db.prepare(sql).run(...args);
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function checkPassword(password) {
  const stored = get('SELECT value FROM settings WHERE key=?', 'password').value;
  const [salt, hash] = stored.split(':');
  return timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(password, salt, 64));
}
if (!get('SELECT key FROM settings WHERE key=?', 'password')) {
  run('INSERT INTO settings VALUES (?,?)', 'password', hashPassword(process.env.GATHER_INITIAL_PASSWORD || '123456789'));
}
run("UPDATE items SET import_status='failed', import_message='Import was interrupted. You can retry it.' WHERE import_status IN ('pending','importing')");

export function state() {
  const assets = all('SELECT * FROM assets ORDER BY position');
  const elements = all('SELECT * FROM elements ORDER BY z');
  const itemLinks = all('SELECT * FROM project_items');
  const boardLinks = all('SELECT * FROM project_boards');
  return {
    items: all('SELECT * FROM items ORDER BY created DESC').map(item => ({ ...item, tags: JSON.parse(item.tags), assets: assets.filter(a => a.item_id === item.id), projectIds: itemLinks.filter(l => l.item_id === item.id).map(l => l.project_id), boardIds: [...new Set(elements.filter(e => e.item_id === item.id).map(e => e.board_id))] })),
    boards: all('SELECT * FROM boards ORDER BY created DESC').map(b => ({ ...b, elements: elements.filter(e => e.board_id === b.id), projectIds: boardLinks.filter(l => l.board_id === b.id).map(l => l.project_id) })),
    projects: all('SELECT * FROM projects ORDER BY created DESC').map(p => ({ ...p, itemIds: itemLinks.filter(l => l.project_id === p.id).map(l => l.item_id), boardIds: boardLinks.filter(l => l.project_id === p.id).map(l => l.board_id) })),
  };
}
