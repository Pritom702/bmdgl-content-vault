import fs from 'node:fs';
import { db } from './db.js';
import { config } from './config.js';
import { analyzeUrl, isVideoPlatform } from '../public/js/platforms.js';
import { fetchMetadata, resolveUrl } from './metadata.js';
import { archiveVideo, saveThumbnail, thumbnailFromVideo, absData, removeDataFile } from './media.js';
import { aiEnabled, analyzeItem } from './ai.js';

const queue = [];
const queued = new Set();
let running = 0;
const CONCURRENCY = 2;

const getItem = (id) => db.prepare('SELECT * FROM items WHERE id = ?').get(id);
const touch = (id, fields) => {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db.prepare(`UPDATE items SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...keys.map(k => fields[k]), id);
};

/**
 * Queue background processing for an item.
 * steps: { meta: bool, archive: bool, ai: bool }
 */
export function enqueue(id, steps = { meta: true, archive: true, ai: true }) {
  if (globalThis.process.env.DISABLE_JOBS === '1') return;
  const key = `${id}`;
  if (queued.has(key)) {
    const existing = queue.find(q => q.id === id);
    if (existing) for (const k of Object.keys(steps)) existing.steps[k] = existing.steps[k] || steps[k];
    return;
  }
  queued.add(key);
  queue.push({ id, steps: { ...steps } });
  if (steps.ai && aiEnabled()) touch(id, { ai_status: 'pending', ai_error: null });
  pump();
}

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const job = queue.shift();
    running++;
    process(job)
      .catch(e => console.error(`[jobs] item ${job.id} failed:`, e))
      .finally(() => { running--; queued.delete(`${job.id}`); pump(); });
  }
}

export function queueSize() {
  return queue.length + running;
}

async function process({ id, steps }) {
  let item = getItem(id);
  if (!item) return;

  // 1. Resolve short links + metadata
  if (steps.meta && item.url) {
    let url = item.canonical_url || item.url;
    const info0 = analyzeUrl(url);
    if (info0?.needsResolve) {
      const resolved = await resolveUrl(url);
      const info1 = analyzeUrl(resolved);
      if (info1) {
        url = info1.canonicalUrl;
        touch(id, { canonical_url: url, platform: info1.platform, content_type: info1.contentType });
      }
    }
    const info = analyzeUrl(url);
    if (info) {
      const meta = await fetchMetadata(url, info);
      item = getItem(id);
      if (!item) return;
      const upd = {};
      if (meta.title && item.title_source !== 'user' && !item.title) { upd.title = meta.title; upd.title_source = 'meta'; }
      if (meta.caption && !item.caption) upd.caption = meta.caption;
      if (meta.author_name && !item.author_name) upd.author_name = meta.author_name;
      if (meta.author_url && !item.author_url) upd.author_url = meta.author_url;
      if (meta.duration && !item.duration) upd.duration = meta.duration;
      if (meta.thumbnail_url && !item.thumb_path) {
        const t = await saveThumbnail(id, meta.thumbnail_url);
        if (t) upd.thumb_path = t;
      }
      touch(id, upd);
    }
  }

  // 2. Offline copy of the video (so it always plays inside the Vault)
  item = getItem(id);
  if (!item) return;
  const info = item.canonical_url ? analyzeUrl(item.canonical_url) : null;
  const wantArchive = steps.archive === 'force'
    || (steps.archive && config.autoArchive && info && isVideoPlatform(info) && info.platform !== 'youtube' && !item.media_path);
  if (wantArchive && config.hasYtdlp && info) {
    touch(id, { archive_status: 'processing', archive_error: null });
    try {
      const { relPath, mime } = await archiveVideo(id, item.canonical_url);
      const cur = getItem(id);
      if (!cur) { removeDataFile(relPath); return; }
      if (cur.media_path && cur.media_path !== relPath && cur.media_source === 'archive') removeDataFile(cur.media_path);
      touch(id, { media_path: relPath, media_mime: mime, media_source: 'archive', archive_status: 'done' });
      if (!cur.thumb_path && mime.startsWith('video/')) {
        const t = await thumbnailFromVideo(id, relPath);
        if (t) touch(id, { thumb_path: t });
      }
    } catch (e) {
      touch(id, { archive_status: 'failed', archive_error: e.message.slice(0, 500) });
    }
  } else if (steps.archive === 'force' && !config.hasYtdlp) {
    touch(id, { archive_status: 'failed', archive_error: 'yt-dlp is not installed on the server.' });
  }

  // Thumbnail for uploaded videos
  item = getItem(id);
  if (item && !item.thumb_path && item.media_path && (item.media_mime || '').startsWith('video/')) {
    const t = await thumbnailFromVideo(id, item.media_path);
    if (t) touch(id, { thumb_path: t });
  }

  // 3. AI analysis
  if (steps.ai) {
    if (!aiEnabled()) { touch(id, { ai_status: 'disabled' }); return; }
    touch(id, { ai_status: 'processing', ai_error: null });
    try {
      item = getItem(id);
      if (!item) return;
      const resources = db.prepare('SELECT kind, title, content, url FROM resources WHERE item_id = ? ORDER BY id').all(id);
      const sharer = item.shared_by ? db.prepare('SELECT name FROM users WHERE id = ?').get(item.shared_by) : null;
      const media = [];
      if (item.media_path) {
        const p = absData(item.media_path);
        if (p && fs.existsSync(p)) media.push({ absPath: p, mime: item.media_mime || 'video/mp4' });
      }
      for (const a of db.prepare('SELECT file_path, mime FROM attachments WHERE item_id = ? ORDER BY id').all(id)) {
        const p = absData(a.file_path);
        if (p && fs.existsSync(p) && a.mime && (a.mime.startsWith('video/') || a.mime.startsWith('image/') || a.mime === 'application/pdf')) {
          media.push({ absPath: p, mime: a.mime });
        }
      }
      const { analysis, source } = await analyzeItem({ item, resources, sharerName: sharer?.name, media });
      const cur = getItem(id);
      if (!cur) return;
      const upd = {
        ai_status: 'done',
        ai_error: null,
        ai_source: source,
        ai_json: JSON.stringify(analysis),
        summary: analysis.summary || null,
        what_it_does: analysis.what_it_does || null,
        hook_text: analysis.hook.text || null,
        usefulness: analysis.usefulness,
      };
      if (cur.title_source !== 'user' && analysis.title) { upd.title = analysis.title; upd.title_source = 'ai'; }
      if (!cur.category_locked && analysis.category) upd.category = analysis.category;
      if (analysis.content_type && (cur.content_type === 'other' || cur.content_type === 'article') && cur.platform !== 'web') upd.content_type = analysis.content_type;
      if (!cur.comment_keyword && analysis.comment_keyword) {
        upd.comment_keyword = analysis.comment_keyword;
        if (cur.resource_status === 'none') upd.resource_status = 'need_comment';
      }
      touch(id, upd);
      const ins = db.prepare('INSERT OR IGNORE INTO item_tags(item_id, tag) VALUES (?, ?)');
      for (const t of analysis.tags) ins.run(id, t);
    } catch (e) {
      touch(id, { ai_status: 'failed', ai_error: String(e.message || e).slice(0, 500) });
    }
  }
}

/** On boot: re-queue anything that was interrupted by a restart. */
export function resumeInterrupted() {
  const rows = db.prepare(`SELECT id, ai_status, archive_status FROM items WHERE ai_status IN ('pending','processing') OR archive_status = 'processing'`).all();
  for (const r of rows) {
    enqueue(r.id, { meta: false, archive: r.archive_status === 'processing' ? 'force' : false, ai: r.ai_status === 'pending' || r.ai_status === 'processing' });
  }
  if (!aiEnabled()) db.prepare(`UPDATE items SET ai_status = 'disabled' WHERE ai_status IN ('pending','processing')`).run();
  if (rows.length) console.log(`[jobs] resumed ${rows.length} interrupted item(s)`);
}

