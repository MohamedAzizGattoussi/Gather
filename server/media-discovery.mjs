import { load } from 'cheerio';

const LIMIT = 40;
function webUrl(value, base) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { const url = new URL(value, base); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}

// One result per original slide, never one result per thumbnail rendition.
export function extractorMedia(result, sourceUrl) {
  if (Array.isArray(result?.gather_media)) {
    const media = result.gather_media.filter(entry => entry && webUrl(entry.url)).map((entry, index) => ({ url: entry.url, key: entry.key || `${sourceUrl}#slide-${index + 1}`, kind: entry.kind || 'unknown' }));
    const expected = Number(result.expected_count) || result.gather_media.length;
    return { media: media.slice(0, LIMIT), expected, uncertain: media.length !== expected || expected > LIMIT };
  }
  if (Array.isArray(result)) {
    const files = result.filter(entry => entry?.[0] === 3 && webUrl(entry[1]));
    const media = files.map((entry, index) => ({ url: entry[1], key: `${sourceUrl.split('?')[0]}#slide-${index + 1}`, kind: 'unknown' }));
    return { media: media.slice(0, LIMIT), expected: media.length, uncertain: media.length >= LIMIT };
  }
  const entries = Array.isArray(result?.entries) ? result.entries : [result];
  const media = [];
  let missing = 0;
  for (const entry of entries) {
    if (!entry) { missing++; continue; }
    const formats = (entry.formats || []).filter(format => webUrl(format.url) && format.vcodec !== 'none' && format.acodec !== 'none' && !/m3u8|dash/.test(format.protocol || '') && !/\.m3u8/.test(format.url));
    const chosen = formats.filter(format => !format.height || format.height <= 1080).at(-1) || formats.at(-1);
    const url = chosen?.url || (!entry.formats && webUrl(entry.url) ? entry.url : null);
    if (url) media.push({ url, key: `${sourceUrl.split('?')[0]}#${entry.id || media.length + 1}`, kind: 'video' });
    else missing++;
  }
  const expected = Number(result?.playlist_count) || entries.length;
  return { media: media.slice(0, LIMIT), expected, uncertain: missing > 0 || media.length !== expected || expected > LIMIT };
}

export function pageMedia(html, base) {
  const $ = load(html);
  const media = [];
  const seen = new Set();
  function add(value, kind = 'image') {
    const url = webUrl(value, base);
    if (!url || seen.has(url)) return;
    seen.add(url); media.push({ url, key: url, kind });
  }
  function imageUrl(node) {
    const srcset = node.attr('data-srcset') || node.attr('srcset');
    if (srcset) {
      const candidates = srcset.split(',').map(part => part.trim().split(/\s+/)).filter(parts => parts[0]);
      candidates.sort((a, b) => (parseFloat(a[1]) || 0) - (parseFloat(b[1]) || 0));
      if (candidates.length) return candidates.at(-1)[0];
    }
    return node.attr('data-src') || node.attr('data-lazy-src') || node.attr('data-original') || node.attr('src');
  }
  function nodes(scope) {
    scope.find('img,video').each((_, el) => {
      const node = $(el);
      if (node.is('video')) add(node.attr('src') || node.find('source').first().attr('src'), 'video');
      else add(imageUrl(node));
    });
  }
  // Prefer an explicitly marked carousel to the page's single Open Graph cover.
  const carousels = $('[aria-roledescription="carousel"], [data-carousel], .carousel, .swiper, .swiper-container, .splide, .slick-slider, .image-gallery, .gallery');
  carousels.each((_, el) => { if (!media.length) nodes($(el)); });
  if (media.length > 1) return { media: media.slice(0, LIMIT), expected: media.length, uncertain: media.length > LIMIT };
  media.length = 0; seen.clear();

  // Schema.org ImageGallery / ItemList / image arrays retain the author's slide order.
  function images(value) {
    if (typeof value === 'string') add(value);
    else if (Array.isArray(value)) value.forEach(images);
    else if (value && typeof value === 'object') {
      if (value.contentUrl || value.url) add(value.contentUrl || value.url, /VideoObject/.test(String(value['@type'])) ? 'video' : 'image');
      else if (value.item) images(value.item);
    }
  }
  function structured(value) {
    if (Array.isArray(value)) { value.forEach(structured); return; }
    if (!value || typeof value !== 'object') return;
    if (value['@graph']) structured(value['@graph']);
    if (Array.isArray(value.image) && value.image.length > 1) images(value.image);
    if (/ImageGallery|MediaGallery|ItemList/.test(String(value['@type']))) {
      const entries = value.itemListElement || value.associatedMedia || value.hasPart || value.image;
      if (Array.isArray(entries)) images([...entries].sort((a, b) => (a?.position || 0) - (b?.position || 0)));
    }
  }
  $('script[type="application/ld+json"]').each((_, el) => { try { structured(JSON.parse($(el).text())); } catch { /* Ignore malformed unrelated structured data. */ } });
  if (media.length > 1) return { media: media.slice(0, LIMIT), expected: media.length, uncertain: media.length > LIMIT };

  // Outside an identified gallery, collection completeness cannot be established.
  $('video').each((_, el) => add($(el).attr('src') || $(el).find('source').first().attr('src'), 'video'));
  $('meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:secure_url"]').each((_, el) => add($(el).attr('content'), 'video'));
  $('main,article').each((_, el) => nodes($(el)));
  $('meta[property="og:image"],meta[property="og:image:secure_url"],meta[name="twitter:image"]').each((_, el) => add($(el).attr('content')));
  return { media: media.slice(0, LIMIT), expected: media.length, uncertain: true };
}
