import { writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileTypeFromFile } from 'file-type';
import { db, mediaDir, tempDir, all, get, run, id } from './db.mjs';
import { discover, fetchPublic, validUrl } from './source-resolver.mjs';
export { fetchPublic, validUrl } from './source-resolver.mjs';
const queue = [];
let working = false;
export async function storeMedia(itemId, temporary, originalName, source = '', position, sourceKey = '') {
  const type = await fileTypeFromFile(temporary);
  if (!type || !/^(image|video)\//.test(type.mime) || ['image/svg+xml'].includes(type.mime)) {
    await unlink(temporary).catch(() => {});
    throw new Error('Use an image or video file. SVG and unknown file formats are not supported.');
  }
  if (!get('SELECT id FROM items WHERE id=?', itemId)) { await unlink(temporary).catch(() => {}); return; }
  const assetId = id(); const filename = `${assetId}.${type.ext}`;
  const { stat } = await import('node:fs/promises');
  const size = (await stat(temporary)).size;
  await rename(temporary, path.join(mediaDir, filename));
  try {
    run('INSERT INTO assets (id,item_id,filename,mime,original_name,source,position,size,source_key) VALUES (?,?,?,?,?,?,?,?,?)', assetId, itemId, filename, type.mime, originalName, source, position ?? Number(get('SELECT COALESCE(MAX(position),-1)+1 AS n FROM assets WHERE item_id=?', itemId).n), size, sourceKey);
  } catch (e) { await unlink(path.join(mediaDir, filename)).catch(() => {}); throw e; }
  const assets = all('SELECT mime FROM assets WHERE item_id=?', itemId);
  run('UPDATE items SET kind=? WHERE id=?', assets.length > 1 ? 'carousel' : assets[0].mime.startsWith('video/') ? 'video' : 'image', itemId);
  return assetId;
}

async function perform(itemId) {
  const item = get('SELECT * FROM items WHERE id=?', itemId);
  if (!item) return;
  run("UPDATE items SET import_status='importing', import_message='' WHERE id=?", itemId);
  let saved = 0, failed = 0;
  const imported = [];
  try {
    const found = await discover(item.url);
    for (const slide of found.media) {
      const { url, key } = slide;
      if (!get('SELECT id FROM items WHERE id=?', itemId)) return;
      const existing = get('SELECT id FROM assets WHERE item_id=? AND ((source_key<>? AND source_key=?) OR source=?)', itemId, '', key, url);
      if (existing) { imported.push(existing.id); saved++; continue; }
      let temporary;
      try {
        const response = found.direct || await fetchPublic(url);
        temporary = path.join(tempDir, id());
        await writeFile(temporary, response.buffer);
        const assetId = await storeMedia(itemId, temporary, `Slide ${imported.length + 1}`, url, undefined, key);
        if (assetId) { imported.push(assetId); saved++; }
      } catch { failed++; if (temporary) await unlink(temporary).catch(() => {}); }
    }
    const partial = failed > 0 || found.uncertain || saved !== found.expected;
    if (saved && !partial) {
      // Upgrade an old cover-only import only after the full carousel is safely stored.
      // Keep manually attached files, and preserve old imports if any new slide failed.
      const assets = all('SELECT * FROM assets WHERE item_id=? ORDER BY position', itemId);
      const obsolete = assets.filter(asset => asset.source && !imported.includes(asset.id));
      const ordered = [...imported, ...assets.filter(asset => !asset.source && !imported.includes(asset.id)).map(asset => asset.id)];
      db.exec('BEGIN');
      try {
        obsolete.forEach(asset => run('DELETE FROM assets WHERE id=? AND item_id=?', asset.id, itemId));
        ordered.forEach((assetId, index) => run('UPDATE assets SET position=? WHERE id=? AND item_id=?', index, assetId, itemId));
        const first = get('SELECT mime FROM assets WHERE item_id=? ORDER BY position LIMIT 1', itemId);
        run('UPDATE items SET kind=? WHERE id=?', ordered.length > 1 ? 'carousel' : first?.mime.startsWith('video/') ? 'video' : 'image', itemId);
        db.exec('COMMIT');
      } catch(e) { db.exec('ROLLBACK'); throw e; }
      // Retain obsolete files on disk until a future explicit storage cleanup, so a
      // concurrent backup of the previous snapshot can still include its media.
    }
    run('UPDATE items SET import_status=?, import_message=? WHERE id=?', saved ? (partial ? 'partial' : 'complete') : 'failed', saved ? (partial ? `${saved} file${saved === 1 ? '' : 's'} stored. ${failed ? `${failed} could not be downloaded. ` : ''}Check the source for missing slides; you can attach them manually.` : `${saved} file${saved === 1 ? '' : 's'} stored on your computer.`) : 'The source did not provide downloadable image or video files. Your link is saved; attach files manually.', itemId);
  } catch (e) { run("UPDATE items SET import_status='failed', import_message=? WHERE id=?", String(e.message).slice(0, 500), itemId); }
}

export function enqueueImport(itemId) {
  const item = get('SELECT * FROM items WHERE id=?', itemId);
  if (!item || ['pending', 'importing'].includes(item.import_status)) return;
  validUrl(item.url);
  run("UPDATE items SET import_status='pending', import_message='' WHERE id=?", itemId);
  queue.push(itemId);
  drain();
}
async function drain() {
  if (working) return;
  working = true;
  try { while (queue.length) await perform(queue.shift()); } finally { working = false; }
}
