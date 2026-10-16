import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseKey, ownerEmail } from './config.mjs';

export function clientFor(accessToken) {
  return createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, ...(accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {}) });
}
export function result(value) {
  if (value.error) {
    const error = new Error(value.error.message || 'Supabase could not complete this action.');
    error.status = value.error.code === '40001' ? 409 : value.status === 401 ? 401 : 400;
    throw error;
  }
  return value.data;
}
export async function requireOwner(client, user) {
  if (!user || user.email?.toLowerCase() !== ownerEmail) throw Object.assign(new Error('Only the configured Gather owner can sign in.'), { status: 403 });
  const owner = result(await client.from('gather_owner').select('user_id').eq('user_id', user.id).maybeSingle());
  if (!owner) throw Object.assign(new Error('Finish the Gather schema and owner setup in Supabase before signing in.'), { status: 403 });
  return user;
}

export async function cloudState(client) {
  // Explicit pagination avoids silently losing references at Supabase's row limit.
  async function rows(table, column = 'id', ascending = true) {
    const records = [];
    for (let offset = 0; ; offset += 500) {
      const page = result(await client.from(`gather_${table}`).select('*').order(column, { ascending }).range(offset, offset + 499));
      records.push(...page);
      if (page.length < 500) return records;
    }
  }
  const [items, assets, boards, elements, projects, itemLinks, boardLinks] = await Promise.all([
    rows('items','created',false), rows('assets','position'), rows('boards','created',false), rows('elements','z'), rows('projects','created',false), rows('project_items','item_id'), rows('project_boards','board_id'),
  ]);
  return {
    items: items.map(i => ({ ...i, assets: assets.filter(a => a.item_id === i.id), projectIds: itemLinks.filter(l => l.item_id === i.id).map(l => l.project_id), boardIds: [...new Set(elements.filter(e => e.item_id === i.id).map(e => e.board_id))] })),
    boards: boards.map(b => ({ ...b, elements: elements.filter(e => e.board_id === b.id), projectIds: boardLinks.filter(l => l.board_id === b.id).map(l => l.project_id) })),
    projects: projects.map(p => ({ ...p, itemIds: itemLinks.filter(l => l.project_id === p.id).map(l => l.item_id), boardIds: boardLinks.filter(l => l.project_id === p.id).map(l => l.board_id) })),
  };
}
