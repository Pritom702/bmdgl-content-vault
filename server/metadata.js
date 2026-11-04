import { execFile } from 'node:child_process';
import { analyzeUrl } from '../public/js/platforms.js';
import { config } from './config.js';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const BOT_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

export async function fetchWithTimeout(url, opts = {}, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { redirect: 'follow', ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
function safeCodePoint(n) {
  try { return String.fromCodePoint(n); } catch { return ''; }
}

function metaTag(html, names) {
  for (const name of names) {
    const esc = name.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&');
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]*content=["']([^"']*)["']`, 'i');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${esc}["']`, 'i');
    const m = html.match(re1) || html.match(re2);
    if (m && m[1].trim()) return decodeEntities(m[1].trim());
  }
  return null;
}

export async function resolveUrl(url) {
  try {
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' } }, 10000);
    let finalUrl = res.url || url;
    try { await res.body?.cancel(); } catch { /* ignore */ }
    const u = new URL(finalUrl);
    if (/facebook\.com$/.test(u.hostname.replace(/^www\./, '')) && u.pathname.startsWith('/login') && u.searchParams.get('next')) {
      finalUrl = u.searchParams.get('next');
    }
    const info = analyzeUrl(finalUrl);
    if (!info) return url;
    return info.platform !== 'web' ? finalUrl : url;
  } catch {
    return url;
  }
}

async function oembed(endpoint) {
  try {
    const res = await fetchWithTimeout(endpoint, { headers: { 'User-Agent': BROWSER_UA } }, 10000);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function openGraph(url) {
  for (const ua of [BOT_UA, BROWSER_UA]) {
    try {
      const res = await fetchWithTimeout(url, { headers: { 'User-Agent': ua, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.8' } }, 12000);
      if (!res.ok) continue;
      const type = res.headers.get('content-type') || '';
      if (!type.includes('html')) continue;
      const html = (await res.text()).slice(0, 600000);
      const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      const out = {
        title: metaTag(html, ['og:title', 'twitter:title']) || (titleTag ? decodeEntities(titleTag[1].trim()) : null),
        caption: metaTag(html, ['og:description', 'twitter:description', 'description']),
        thumbnail_url: metaTag(html, ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']),
        author_name: metaTag(html, ['author', 'article:author', 'og:site_name']),
      };
      if (out.title || out.caption || out.thumbnail_url) return out;
    } catch { /* try next UA */ }
  }
  return null;
}

export function ytdlpArgs(extra) {
  const args = ['--no-warnings', '--no-playlist', '--socket-timeout', '20'];
  if (config.ytdlpCookies) args.push('--cookies', config.ytdlpCookies);
  return args.concat(extra);
}

export function runYtdlp(args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    execFile(config.ytdlpBin, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || err.message || '').split('\n').filter(l => /error/i.test(l)).join(' ').trim() || err.message;
        return reject(new Error(msg.slice(0, 500)));
      }
      resolve(stdout);
    });
  });
}

async function ytdlpInfo(url) {
  if (!config.hasYtdlp) return null;
  try {
    const out = await runYtdlp(ytdlpArgs(['--dump-single-json', '--skip-download', url]), 60000);
    const j = JSON.parse(out);
    return {
      title: j.title || j.fulltitle || null,
      caption: j.description || null,
      thumbnail_url: j.thumbnail || (Array.isArray(j.thumbnails) && j.thumbnails.length ? j.thumbnails[j.thumbnails.length - 1].url : null),
      author_name: j.uploader || j.channel || j.creator || null,
      author_url: j.uploader_url || j.channel_url || null,
      duration: j.duration || null,
    };
  } catch {
    return null;
  }
}

function clean(s, max) {
  if (!s) return null;
  const t = String(s).replace(/\r\n/g, '\n').replace(/\s+\n/g, '\n').trim();
  if (!t) return null;
  return max && t.length > max ? t.slice(0, max) : t;
}

function looksGeneric(title) {
  if (!title) return true;
  return /^(instagram|facebook|tiktok|youtube|log in|login|skool|x|twitter|watch|reels?|google docs|google drive)$/i.test(title.trim())
    || /log in or sign up|log into facebook|instagram photos and videos|sign in - google accounts/i.test(title);
}

/** Best-effort metadata for any URL. Never throws. */
export async function fetchMetadata(url, info) {
  const out = { title: null, caption: null, full_text: null, thumbnail_url: null, author_name: null, author_url: null, duration: null };
  const merge = (m) => {
    if (!m) return;
    for (const k of Object.keys(out)) {
      if (!m[k]) continue;
      if (k === 'title' && looksGeneric(m[k])) continue;
      if (!out[k] || (k === 'caption' && String(m[k]).length > String(out[k]).length)) out[k] = m[k];
    }
  };
  const enc = encodeURIComponent(url);

  try {
    // Special handling for Google Docs to extract full untruncated text
    const gdocMatch = String(url).match(/docs\.google\.com\/document\/d\/([\w-]{10,})/i);
    if (gdocMatch) {
      try {
        const exportRes = await fetchWithTimeout(`https://docs.google.com/document/d/${gdocMatch[1]}/export?format=txt`, { headers: { 'User-Agent': BROWSER_UA } }, 10000);
        if (exportRes.ok) {
          const txt = (await exportRes.text()).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
          if (txt && !txt.startsWith('<!DOCTYPE')) {
            out.full_text = txt.slice(0, 25000);
          }
        }
      } catch { /* ignore */ }
    }

    if (info.platform === 'youtube') {
      const o = await oembed(`https://www.youtube.com/oembed?url=${enc}&format=json`);
      if (o) merge({ title: o.title, author_name: o.author_name, author_url: o.author_url, thumbnail_url: info.id ? `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg` : o.thumbnail_url });
    } else if (info.platform === 'tiktok') {
      const o = await oembed(`https://www.tiktok.com/oembed?url=${enc}`);
      if (o) merge({ title: o.title, caption: o.title, author_name: o.author_name, author_url: o.author_url, thumbnail_url: o.thumbnail_url });
    } else if (info.platform === 'vimeo') {
      const o = await oembed(`https://vimeo.com/api/oembed.json?url=${enc}`);
      if (o) merge({ title: o.title, caption: o.description, author_name: o.author_name, author_url: o.author_url, thumbnail_url: o.thumbnail_url, duration: o.duration });
    } else if (info.platform === 'loom') {
      const o = await oembed(`https://www.loom.com/v1/oembed?url=${enc}`);
      if (o) merge({ title: o.title, thumbnail_url: o.thumbnail_url, duration: o.duration });
    }

    if (['youtube', 'instagram', 'facebook', 'tiktok', 'x', 'threads', 'linkedin'].includes(info.platform) && ['reel', 'short', 'video', 'post', 'carousel', 'thread'].includes(info.contentType)) {
      merge(await ytdlpInfo(url));
    }
    if (!out.title || !out.caption || !out.thumbnail_url) merge(await openGraph(url));
  } catch { /* best effort */ }

  if (out.title) {
    out.title = out.title.replace(/\s*-\s*Google Docs$/i, '').replace(/\s*-\s*YouTube$/i, '').trim();
  }
  out.title = clean(out.title, 300);
  out.caption = clean(out.caption, 8000);
  out.author_name = clean(out.author_name, 200);
  return out;
}
