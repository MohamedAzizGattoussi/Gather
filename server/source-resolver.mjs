import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import path from 'node:path';
import ipaddr from 'ipaddr.js';
import { extractorMedia, pageMedia } from './media-discovery.mjs';
const execute = promisify(execFile);
const MAX_FILE = 150 * 1024 * 1024;
const userAgent = 'Mozilla/5.0 (compatible; Gather/0.1; personal local library)';
export function validUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new Error('Use a public http or https link without credentials or custom ports.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(hostname) && ipaddr.process(hostname).range() !== 'unicast') throw new Error('Only public internet sources can be imported.');
  return url;
}
function publicLookup(hostname, options, callback) {
  lookup(hostname, { all: true }, (error, addresses) => {
    if (error) return callback(error);
    const safe = addresses.filter(({ address }) => {
      try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
    });
    if (!safe.length || safe.length !== addresses.length) return callback(new Error('Only public internet sources can be imported.'));
    callback(null, options.all ? safe : safe[0].address, safe[0].family);
  });
}
export function fetchPublic(value, maxBytes = MAX_FILE, redirects = 0) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = validUrl(value); } catch (e) { reject(e); return; }
    if (redirects > 5) return reject(new Error('Too many redirects.'));
    let totalTimer;
    const request = (url.protocol === 'https:' ? https : http).get(url, {
      lookup: publicLookup,
      headers: { 'User-Agent': userAgent, Accept: '*/*', 'Accept-Encoding': 'identity' },
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume(); clearTimeout(totalTimer);
        if (!response.headers.location) return reject(new Error('Invalid source redirect.'));
        try { resolve(fetchPublic(new URL(response.headers.location, url).href, maxBytes, redirects + 1)); } catch(e) { reject(e); }
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume(); clearTimeout(totalTimer);
        return reject(new Error('This source blocked the request or requires signing in. Attach the media manually instead.'));
      }
      if (Number(response.headers['content-length'] || 0) > maxBytes) {
        response.destroy(); clearTimeout(totalTimer); return reject(new Error('This file exceeds the import size limit.'));
      }
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) response.destroy(new Error('This file exceeds the import size limit.'));
        else chunks.push(chunk);
      });
      response.on('error', error => { clearTimeout(totalTimer); reject(error); });
      response.on('end', () => { clearTimeout(totalTimer); resolve({ buffer: Buffer.concat(chunks), type: String(response.headers['content-type'] || ''), url: url.href }); });
    });
    totalTimer = setTimeout(() => request.destroy(new Error('The source took too long to respond.')), 35000);
    request.on('error', error => { clearTimeout(totalTimer); reject(error); });
  });
}

async function extractSocial(url) {
  const host = new URL(url).hostname.toLowerCase();
  const social = /(^|\.)(instagram\.com|facebook\.com|fb\.watch|pinterest\.[a-z.]+|pin\.it)$/.test(host);
  if (!social) return null;
  // Restrict external extractors to individual public content, never an entire profile or feed.
  const pathname = new URL(url).pathname;
  if (/instagram/.test(host) && !/^\/(p|reel|reels|tv)\//.test(pathname)) throw new Error('Paste a link to one Instagram post or reel, rather than a profile.');
  if (/pinterest/.test(host) && !/^\/pin\//.test(pathname)) throw new Error('Paste a link to one Pinterest pin, rather than a board or profile.');
  if (/facebook/.test(host) && !(/\/(reel|watch|photo|photos|videos|posts|share)(\/|\.|$)/.test(pathname) || /\/(videos|posts|photos)\//.test(pathname) || pathname.includes('story.php') || pathname.includes('permalink.php'))) throw new Error('Paste a link to one Facebook post, photo, or video.');
  // Resolve the original hostname through the same public-address guard before calling an extractor.
  await new Promise((resolve, reject) => publicLookup(host, {}, error => error ? reject(error) : resolve()));
  const modes = /(^|\.)instagram\.com$/.test(host) ? ['instagram', 'gallery', 'video'] : ['gallery', 'video'];
  for (const mode of modes) {
    try {
      const { stdout } = await execute(process.env.GATHER_PYTHON || 'python', [path.join(import.meta.dirname, 'extract.py'), url, mode], { timeout: 75000, maxBuffer: 12 * 1024 * 1024, windowsHide: true });
      const result = JSON.parse(stdout);
      if (result.error) continue;
      const found = extractorMedia(result, url);
      if (found.media.length) return found;
    } catch { /* Try the next public extractor, then the page itself. */ }
  }
  return null;
}

export async function discover(url) {
  const social = await extractSocial(url);
  if (social?.media.length) return social;
  const page = await fetchPublic(url);
  if (/^(image|video)\//i.test(page.type)) return { direct: page, media: [{ url, key: url, kind: page.type.startsWith('video') ? 'video' : 'image' }], expected: 1, uncertain: false };
  if (page.buffer.length > 5 * 1024 * 1024) throw new Error('This page is too large to inspect. Attach its media manually.');
  const found = pageMedia(page.buffer.toString('utf8'), page.url);
  if (!found.media.length) throw new Error('No downloadable public media was found. The source may require signing in. Your link is saved; you can attach files manually.');
  return found;
}

