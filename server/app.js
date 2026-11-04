import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db, tx } from './db.js';
import {
  loadUser, requireUser, requireAdmin, createUser, createSession, destroySession, verifyPassword, hashPassword,
  publicUser, userCount, inviteCode, newInviteCode, rateLimit, cleanupSessions,
} from './auth.js';
import { analyzeUrl, extractUrl, CATEGORIES, STATUSES, RESOURCE_STATUSES, RESOURCE_KINDS, CONTENT_TYPES, PLATFORMS } from '../public/js/platforms.js';
import { enqueue, resumeInterrupted, queueSize } from './jobs.js';
import { aiEnabled } from './ai.js';
import { removeDataFile, mimeFor } from './media.js';

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// ---------- Security headers ----------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "frame-src https:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '));
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(loadUser);

// CSRF protection: every state-changing API call must carry a custom header,
// which browsers never attach to cross-site form posts.
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.get('X-Vault') !== '1') {
    return res.status(403).json({ error: 'Missing request header.' });
  }
  next();
});

// ---------- Helpers ----------
const ALLOWED_EXT = new Set(['.mp4', '.mov', '.webm', '.m4v', '.mkv', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.pdf', '.txt', '.md',
  '.mp3', '.m4a', '.wav', '.docx', '.pptx', '.xlsx', '.csv', '.json', '.zip']);
const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(config.dataDir, 'uploads'),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: config.maxUploadMB * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new HttpError(400, `File type ${ext || '(none)'} is not allowed.`));
    cb(null, true);
  },
});

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);

const s = (v, max = 5000) => (v == null ? '' : String(v).trim().slice(0, max));
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const nowIso = () => new Date().toISOString();

function normTags(tags) {
  const list = Array.isArray(tags) ? tags : typeof tags === 'string' ? tags.split(',') : [];
  return [...new Set(list.map(t => String(t).toLowerCase().replace(/^#/, '').trim().slice(0, 40)).filter(Boolean))].slice(0, 20);
}

function validUrlOrEmpty(v) {
  const t = s(v, 2000);
  if (!t) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
    return u.toString();
  } catch {
    throw bad(`"${t.slice(0, 80)}" is not a valid link.`);
  }
}

function getItemOr404(id) {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(int(id));
  if (!item) throw new HttpError(404, 'This item no longer exists.');
  return item;
}

function canManage(user, item) {
  return user.role === 'admin' || item.shared_by === user.id;
}

function parseAi(item) {
  if (!item.ai_json) return null;
  try { return JSON.parse(item.ai_json); } catch { return null; }
}

function fileUrl(rel) {
  return rel ? `/files/${rel.replace(/\\/g, '/')}` : null;
}

function listRow(r) {
  return {
    id: r.id,
    url: r.url,
    canonical_url: r.canonical_url,
    platform: r.platform,
    content_type: r.content_type,
    title: r.title,
    author_name: r.author_name,
    thumb: fileUrl(r.thumb_path),
    media_url: fileUrl(r.media_path),
    media_mime: r.media_mime,
    has_media: Boolean(r.media_path),
    category: r.category,
    status: r.status,
    resource_status: r.resource_status,
    comment_keyword: r.comment_keyword,
    summary: r.summary,
    what_it_does: r.what_it_does,
    hook_text: r.hook_text,
    usefulness: r.usefulness,
    ai_status: r.ai_status,
    created_at: r.created_at,
    tags: r.tags ? r.tags.split('\u001f') : [],
    shared_by: r.sharer_id ? { id: r.sharer_id, name: r.sharer_name, color: r.sharer_color } : null,
    upvotes: r.upvotes || 0,
    upvoted: Boolean(r.upvoted),
    favorite: Boolean(r.favorite),
    comments: r.comments || 0,
    resources: r.resources || 0,
    primary_resource: r.res_id ? {
      id: r.res_id,
      kind: r.res_kind,
      title: r.res_title,
      content: r.res_content,
      url: r.res_url,
    } : null,
  };
}

const LIST_SELECT = `
  SELECT i.*,
    u.id AS sharer_id, u.name AS sharer_name, u.color AS sharer_color,
    (SELECT group_concat(tag, char(31)) FROM item_tags t WHERE t.item_id = i.id) AS tags,
    (SELECT COUNT(*) FROM upvotes v WHERE v.item_id = i.id) AS upvotes,
    EXISTS(SELECT 1 FROM upvotes v WHERE v.item_id = i.id AND v.user_id = @me) AS upvoted,
    EXISTS(SELECT 1 FROM favorites f WHERE f.item_id = i.id AND f.user_id = @me) AS favorite,
    (SELECT COUNT(*) FROM comments c WHERE c.item_id = i.id) AS comments,
    (SELECT COUNT(*) FROM resources r WHERE r.item_id = i.id) AS resources,
    (SELECT r.id FROM resources r WHERE r.item_id = i.id ORDER BY r.id LIMIT 1) AS res_id,
    (SELECT r.kind FROM resources r WHERE r.item_id = i.id ORDER BY r.id LIMIT 1) AS res_kind,
    (SELECT r.title FROM resources r WHERE r.item_id = i.id ORDER BY r.id LIMIT 1) AS res_title,
    (SELECT r.content FROM resources r WHERE r.item_id = i.id ORDER BY r.id LIMIT 1) AS res_content,
    (SELECT r.url FROM resources r WHERE r.item_id = i.id ORDER BY r.id LIMIT 1) AS res_url
  FROM items i LEFT JOIN users u ON u.id = i.shared_by`;

function likeParam(q) {
  return `%${q.replace(/[\\%_]/g, m => '\\' + m)}%`;
}

// ---------- Public ----------
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/bootstrap', (req, res) => {
  res.json({
    appName: config.appName,
    needsSetup: userCount() === 0,
    user: publicUser(req.user),
    features: {
      ai: aiEnabled(),
      aiModel: aiEnabled() ? config.geminiModel : null,
      archive: config.hasYtdlp,
      ffmpeg: config.hasFfmpeg,
      autoArchive: config.autoArchive && config.hasYtdlp,
      maxUploadMB: config.maxUploadMB,
    },
  });
});

app.post('/api/auth/register', (req, res) => {
  if (!rateLimit(`reg:${req.ip}`, 20)) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  const name = s(req.body.name, 80);
  const email = s(req.body.email, 200).toLowerCase();
  const password = String(req.body.password || '');
  const first = userCount() === 0;
  if (!name) throw bad('Please enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Please enter a valid email.');
  if (password.length < 8) throw bad('Password must be at least 8 characters.');
  if (!first && s(req.body.inviteCode, 60).toUpperCase() !== inviteCode().toUpperCase()) throw bad('That invite code is not correct. Ask your admin for the current code.');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw bad('An account with this email already exists. Please sign in.');
  const id = createUser({ name, email, password, role: first ? 'admin' : 'member' });
  createSession(res, id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
});

app.post('/api/auth/login', (req, res) => {
  const email = s(req.body.email, 200).toLowerCase();
  if (!rateLimit(`login:${req.ip}:${email}`, 10)) throw new HttpError(429, 'Too many attempts. Try again in 10 minutes.');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !verifyPassword(String(req.body.password || ''), user.password_hash)) throw bad('Wrong email or password.');
  createSession(res, user.id);
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

app.post('/api/auth/forgot-password', (req, res) => {
  const email = s(req.body.email, 200).toLowerCase();
  const nextPw = String(req.body.newPassword || '');
  if (!rateLimit(`forgot:${req.ip}:${email}`, 15)) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) throw bad('No teammate account found with that email.');
  if (nextPw.length < 6) throw bad('New password must be at least 6 characters.');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(nextPw), user.id);
  createSession(res, user.id);
  res.json({ user: publicUser(user) });
});

// PWA share target: phone "Share -> BMDGL Vault" lands here.
app.get('/share', (req, res) => {
  const url = extractUrl(`${req.query.url || ''} ${req.query.text || ''} ${req.query.title || ''}`) || '';
  const params = new URLSearchParams();
  if (url) params.set('url', url);
  const text = s(req.query.text, 1000);
  if (text && text !== url) params.set('note', text.replace(url, '').trim());
  res.redirect(`/#/add${params.toString() ? '?' + params.toString() : ''}`);
});

// ---------- Protected files (thumbnails, offline copies, uploads) ----------
for (const dir of ['thumbs', 'media', 'uploads']) {
  app.use(`/files/${dir}`, (req, res, next) => {
    if (!req.user) return res.status(401).send('Please sign in.');
    next();
  }, express.static(path.join(config.dataDir, dir), {
    index: false,
    dotfiles: 'deny',
    maxAge: '7d',
    setHeaders: (res, filePath) => {
      const mime = mimeFor(filePath);
      if (!/^(video|image|audio)\//.test(mime) && mime !== 'application/pdf' && mime !== 'text/plain') {
        res.setHeader('Content-Disposition', 'attachment');
      }
    },
  }));
}

// Everything below needs a signed-in user.
app.use('/api', requireUser);

app.get('/api/meta', (_req, res) => {
  res.json({ categories: CATEGORIES, statuses: STATUSES, resourceStatuses: RESOURCE_STATUSES, resourceKinds: RESOURCE_KINDS, contentTypes: CONTENT_TYPES, platforms: PLATFORMS });
});

app.post('/api/me/password', (req, res) => {
  const cur = String(req.body.current || '');
  const next = String(req.body.next || '');
  if (!verifyPassword(cur, req.user.password_hash)) throw bad('Current password is wrong.');
  if (next.length < 8) throw bad('New password must be at least 8 characters.');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
  res.json({ ok: true });
});

app.patch('/api/me', (req, res) => {
  const name = s(req.body.name, 80);
  if (!name) throw bad('Name cannot be empty.');
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

// ---------- URL preview / duplicate check ----------
app.post('/api/preview', (req, res) => {
  const raw = extractUrl(req.body.url) || s(req.body.url, 2000);
  const info = analyzeUrl(raw);
  if (!info) return res.json({ info: null });
  const dup = db.prepare('SELECT i.id, i.title, i.created_at, u.name AS sharer FROM items i LEFT JOIN users u ON u.id = i.shared_by WHERE i.canonical_url = ? OR i.url = ? LIMIT 1')
    .get(info.canonicalUrl, raw);
  res.json({ info, duplicate: dup || null });
});

// ---------- Items ----------
app.get('/api/items', (req, res) => {
  const where = [];
  const p = { me: req.user.id };
  const q = s(req.query.q, 200);
  if (q) {
    const tokens = q.split(/\s+/).filter(Boolean).slice(0, 6);
    tokens.forEach((tok, idx) => {
      const key = `q${idx}`;
      p[key] = likeParam(tok);
      where.push(`(i.title LIKE @${key} ESCAPE '\\' OR i.summary LIKE @${key} ESCAPE '\\' OR i.what_it_does LIKE @${key} ESCAPE '\\'
        OR i.category LIKE @${key} ESCAPE '\\' OR i.platform LIKE @${key} ESCAPE '\\' OR i.caption LIKE @${key} ESCAPE '\\'
        OR i.notes LIKE @${key} ESCAPE '\\' OR i.hook_text LIKE @${key} ESCAPE '\\' OR i.author_name LIKE @${key} ESCAPE '\\'
        OR i.comment_keyword LIKE @${key} ESCAPE '\\' OR i.url LIKE @${key} ESCAPE '\\'
        OR EXISTS(SELECT 1 FROM item_tags t WHERE t.item_id = i.id AND t.tag LIKE @${key} ESCAPE '\\')
        OR EXISTS(SELECT 1 FROM resources r WHERE r.item_id = i.id AND (r.title LIKE @${key} ESCAPE '\\' OR r.content LIKE @${key} ESCAPE '\\' OR r.url LIKE @${key} ESCAPE '\\')))`);
    });
  }
  const eq = (field, key, val) => { if (val) { p[key] = val; where.push(`${field} = @${key}`); } };
  eq('i.platform', 'platform', s(req.query.platform, 40));
  eq('i.category', 'category', s(req.query.category, 80));
  eq('i.content_type', 'ctype', s(req.query.type, 40));
  eq('i.resource_status', 'rstatus', s(req.query.resource, 40));
  const status = s(req.query.status, 40);
  if (status) { p.status = status; where.push('i.status = @status'); }
  else if (req.query.includeArchived !== '1') where.push("i.status != 'archived'");
  const sharer = int(req.query.sharer);
  if (sharer) { p.sharer = sharer; where.push('i.shared_by = @sharer'); }
  const tag = s(req.query.tag, 40).toLowerCase();
  if (tag) { p.tag = tag; where.push('EXISTS(SELECT 1 FROM item_tags t WHERE t.item_id = i.id AND t.tag = @tag)'); }
  if (req.query.fav === '1') where.push('EXISTS(SELECT 1 FROM favorites f WHERE f.item_id = i.id AND f.user_id = @me)');
  if (req.query.pending === '1') where.push("i.resource_status IN ('need_comment','requested')");
  const coll = int(req.query.collection);
  if (coll) { p.coll = coll; where.push('EXISTS(SELECT 1 FROM collection_items ci WHERE ci.item_id = i.id AND ci.collection_id = @coll)'); }

  const sorts = {
    newest: 'i.created_at DESC, i.id DESC',
    oldest: 'i.created_at ASC, i.id ASC',
    top: 'upvotes DESC, i.usefulness DESC, i.created_at DESC',
    useful: 'COALESCE(i.usefulness, 0) DESC, i.created_at DESC',
    title: 'i.title COLLATE NOCASE ASC',
  };
  const order = sorts[req.query.sort] || sorts.newest;
  const limit = Math.min(100, Math.max(1, int(req.query.limit) || 48));
  const page = Math.max(1, int(req.query.page) || 1);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countParams = { ...p };
  if (!whereSql.includes('@me')) delete countParams.me;
  const total = db.prepare(`SELECT COUNT(*) AS n FROM items i ${whereSql}`).get(countParams).n;
  const rows = db.prepare(`${LIST_SELECT} ${whereSql} ORDER BY ${order} LIMIT ${limit} OFFSET ${(page - 1) * limit}`).all(p);
  res.json({ items: rows.map(listRow), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

function itemDetail(id, me) {
  const r = db.prepare(`${LIST_SELECT} WHERE i.id = @id`).get({ id, me });
  if (!r) throw new HttpError(404, 'This item no longer exists.');
  const base = listRow(r);
  return {
    ...base,
    notes: r.notes,
    caption: r.caption,
    author_url: r.author_url,
    duration: r.duration,
    title_source: r.title_source,
    category_locked: Boolean(r.category_locked),
    used_in_url: r.used_in_url,
    what_it_does: r.what_it_does,
    media: r.media_path ? { url: fileUrl(r.media_path), mime: r.media_mime, source: r.media_source } : null,
    archive_status: r.archive_status,
    archive_error: r.archive_error,
    ai_error: r.ai_error,
    ai_source: r.ai_source,
    ai: parseAi(r),
    updated_at: r.updated_at,
    resources_list: db.prepare(`SELECT r.*, u.name AS author FROM resources r LEFT JOIN users u ON u.id = r.created_by WHERE r.item_id = ? ORDER BY r.id`).all(id),
    attachments: db.prepare('SELECT id, file_path, original_name, mime, size, created_at FROM attachments WHERE item_id = ? ORDER BY id').all(id)
      .map(a => ({ id: a.id, url: fileUrl(a.file_path), name: a.original_name, mime: a.mime, size: a.size, created_at: a.created_at })),
    comments_list: db.prepare(`SELECT c.id, c.body, c.created_at, c.user_id, u.name, u.color FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.item_id = ? ORDER BY c.id`).all(id),
    collections: db.prepare('SELECT c.id, c.name, c.emoji FROM collection_items ci JOIN collections c ON c.id = ci.collection_id WHERE ci.item_id = ? ORDER BY c.name').all(id),
  };
}

app.get('/api/items/:id', (req, res) => {
  const id = int(req.params.id);
  res.json({ item: itemDetail(id, req.user.id) });
});

function saveAttachments(itemId, files, userId) {
  const ins = db.prepare('INSERT INTO attachments(item_id, file_path, original_name, mime, size, created_by) VALUES (?, ?, ?, ?, ?, ?)');
  const out = [];
  for (const f of files || []) {
    const rel = `uploads/${f.filename}`;
    const mime = mimeFor(f.filename);
    ins.run(itemId, rel, s(f.originalname, 200), mime, f.size, userId);
    out.push({ rel, mime });
  }
  return out;
}

function cleanupUploaded(files) {
  for (const f of files || []) fs.rmSync(f.path, { force: true });
}

function readItemPayload(req) {
  if (req.is('multipart/form-data')) {
    try { return JSON.parse(req.body.data || '{}'); } catch { throw bad('Invalid form data.'); }
  }
  return req.body || {};
}

app.post('/api/items', upload.array('files', 10), (req, res) => {
  let d;
  try { d = readItemPayload(req); } catch (e) { cleanupUploaded(req.files); throw e; }
  try {
    const rawUrl = extractUrl(d.url) || s(d.url, 2000);
    const info = rawUrl ? analyzeUrl(rawUrl) : null;
    if (rawUrl && !info) throw bad('That link does not look valid. Paste the full link (starting with https://).');
    const resources = (Array.isArray(d.resources) ? d.resources : []).slice(0, 30).map(r => ({
      kind: Object.keys(RESOURCE_KINDS).includes(r.kind) ? r.kind : 'link',
      title: s(r.title, 200),
      content: s(r.content, 50000),
      url: validUrlOrEmpty(r.url),
    })).filter(r => r.title || r.content || r.url);
    if (!info && !(req.files || []).length && !resources.length && !s(d.notes)) {
      throw bad('Add a link, upload a file, or add a prompt/tool so there is something to save.');
    }
    const category = CATEGORIES.includes(d.category) ? d.category : null;
    const status = Object.keys(STATUSES).includes(d.status) ? d.status : 'new';
    const commentKeyword = s(d.comment_keyword, 60);
    let resourceStatus = Object.keys(RESOURCE_STATUSES).includes(d.resource_status) ? d.resource_status : 'none';
    if (resourceStatus === 'none' && commentKeyword && !resources.length) resourceStatus = 'need_comment';
    const title = s(d.title, 200);

    const id = tx(() => {
      const r = db.prepare(`INSERT INTO items(url, canonical_url, platform, content_type, title, title_source, notes, category, category_locked,
          status, resource_status, comment_keyword, shared_by, ai_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        rawUrl || null, info ? info.canonicalUrl : null,
        info ? info.platform : 'upload',
        info ? info.contentType : (resources.some(x => x.kind === 'prompt') && !(req.files || []).length ? 'prompt' : 'other'),
        title, title ? 'user' : 'meta',
        s(d.notes, 5000), category || 'Other', category ? 1 : 0,
        status, resourceStatus, commentKeyword || null, req.user.id, 'pending');
      const itemId = Number(r.lastInsertRowid);
      const insR = db.prepare('INSERT INTO resources(item_id, kind, title, content, url, created_by) VALUES (?, ?, ?, ?, ?, ?)');
      for (const x of resources) insR.run(itemId, x.kind, x.title, x.content, x.url, req.user.id);
      const insT = db.prepare('INSERT OR IGNORE INTO item_tags(item_id, tag) VALUES (?, ?)');
      for (const t of normTags(d.tags)) insT.run(itemId, t);
      const insC = db.prepare('INSERT OR IGNORE INTO collection_items(collection_id, item_id) VALUES (?, ?)');
      for (const c of (Array.isArray(d.collections) ? d.collections : [])) {
        if (db.prepare('SELECT 1 FROM collections WHERE id = ?').get(int(c))) insC.run(int(c), itemId);
      }
      const saved = saveAttachments(itemId, req.files, req.user.id);
      // Upload-only item: the first video/image becomes the main player media.
      const main = saved.find(x => x.mime.startsWith('video/')) || saved.find(x => x.mime.startsWith('image/'));
      if (!info && main) {
        db.prepare("UPDATE items SET media_path = ?, media_mime = ?, media_source = 'upload', content_type = ? WHERE id = ?")
          .run(main.rel, main.mime, main.mime.startsWith('video/') ? 'video' : 'image', itemId);
      }
      const firstFile = (req.files || [])[0]?.originalname?.replace(/\.[a-z0-9]+$/i, '');
      const customResTitle = resources[0]?.title && !/^(Tool \/ Resource Link|Shared Prompt \/ Instructions)$/i.test(resources[0].title) ? resources[0].title : '';
      const fallbackTitle = title || firstFile || customResTitle || (info ? `${PLATFORMS[info.platform]?.label || info.platform} ${CONTENT_TYPES[info.contentType] || 'Content'}` : 'Shared Content');
      const initialSummary = s(d.notes, 500) || resources[0]?.content?.slice(0, 400) || `Fetching ${info ? PLATFORMS[info.platform]?.label : 'content'} title & description…`;
      const initialWhat = s(d.notes, 500) || (resources.length ? `Includes attached ${RESOURCE_KINDS[resources[0].kind] || 'resource'} ready to open or copy.` : 'Auto-detecting description and usage details…');
      db.prepare('UPDATE items SET title = ?, summary = ?, what_it_does = ? WHERE id = ?')
        .run(s(fallbackTitle, 200), initialSummary, initialWhat, itemId);
      return itemId;
    });
    enqueue(id, { meta: Boolean(info), archive: Boolean(info), ai: true });
    res.status(201).json({ item: itemDetail(id, req.user.id) });
  } catch (e) {
    cleanupUploaded(req.files);
    throw e;
  }
});

app.patch('/api/items/:id', (req, res) => {
  const item = getItemOr404(req.params.id);
  const d = req.body || {};
  const upd = {};
  if ('title' in d) { upd.title = s(d.title, 200); upd.title_source = upd.title ? 'user' : 'meta'; }
  if ('notes' in d) upd.notes = s(d.notes, 5000);
  if ('category' in d) {
    if (d.category === 'auto') upd.category_locked = 0;
    else if (CATEGORIES.includes(d.category)) { upd.category = d.category; upd.category_locked = 1; }
    else throw bad('Unknown category.');
  }
  if ('status' in d) { if (!STATUSES[d.status]) throw bad('Unknown status.'); upd.status = d.status; }
  if ('resource_status' in d) { if (!RESOURCE_STATUSES[d.resource_status]) throw bad('Unknown resource status.'); upd.resource_status = d.resource_status; }
  if ('comment_keyword' in d) upd.comment_keyword = s(d.comment_keyword, 60) || null;
  if ('used_in_url' in d) upd.used_in_url = validUrlOrEmpty(d.used_in_url) || null;
  if ('content_type' in d) { if (!CONTENT_TYPES[d.content_type]) throw bad('Unknown type.'); upd.content_type = d.content_type; }
  if ('summary' in d) upd.summary = s(d.summary, 2000) || null;
  if ('what_it_does' in d) upd.what_it_does = s(d.what_it_does, 2000) || null;
  tx(() => {
    const keys = Object.keys(upd);
    if (keys.length) {
      db.prepare(`UPDATE items SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...keys.map(k => upd[k]), item.id);
    }
    if ('tags' in d) {
      db.prepare('DELETE FROM item_tags WHERE item_id = ?').run(item.id);
      const ins = db.prepare('INSERT OR IGNORE INTO item_tags(item_id, tag) VALUES (?, ?)');
      for (const t of normTags(d.tags)) ins.run(item.id, t);
    }
  });
  res.json({ item: itemDetail(item.id, req.user.id) });
});

app.delete('/api/items/:id', (req, res) => {
  const item = getItemOr404(req.params.id);
  if (!canManage(req.user, item)) throw new HttpError(403, 'Only the person who shared this (or an admin) can delete it.');
  const files = [item.thumb_path, item.media_path, ...db.prepare('SELECT file_path FROM attachments WHERE item_id = ?').all(item.id).map(a => a.file_path)];
  db.prepare('DELETE FROM items WHERE id = ?').run(item.id);
  for (const f of new Set(files.filter(Boolean))) removeDataFile(f);
  res.json({ ok: true });
});

app.post('/api/items/:id/reanalyze', (req, res) => {
  const item = getItemOr404(req.params.id);
  enqueue(item.id, { meta: false, archive: false, ai: true });
  res.json({ item: itemDetail(item.id, req.user.id) });
});

app.post('/api/items/:id/refresh', (req, res) => {
  const item = getItemOr404(req.params.id);
  if (!item.canonical_url) throw bad('This item has no link to refresh.');
  enqueue(item.id, { meta: true, archive: false, ai: false });
  res.json({ ok: true });
});

app.post('/api/items/:id/archive', (req, res) => {
  const item = getItemOr404(req.params.id);
  if (!item.canonical_url) throw bad('This item has no link to download from.');
  if (!config.hasYtdlp) throw bad('Saving offline copies needs yt-dlp installed on the server (see README).');
  db.prepare("UPDATE items SET archive_status = 'processing', archive_error = NULL WHERE id = ?").run(item.id);
  enqueue(item.id, { meta: false, archive: 'force', ai: false });
  res.json({ item: itemDetail(item.id, req.user.id) });
});

app.post('/api/items/:id/favorite', (req, res) => {
  const item = getItemOr404(req.params.id);
  const exists = db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND item_id = ?').get(req.user.id, item.id);
  if (exists) db.prepare('DELETE FROM favorites WHERE user_id = ? AND item_id = ?').run(req.user.id, item.id);
  else db.prepare('INSERT INTO favorites(user_id, item_id) VALUES (?, ?)').run(req.user.id, item.id);
  res.json({ favorite: !exists });
});

app.post('/api/items/:id/upvote', (req, res) => {
  const item = getItemOr404(req.params.id);
  const exists = db.prepare('SELECT 1 FROM upvotes WHERE user_id = ? AND item_id = ?').get(req.user.id, item.id);
  if (exists) db.prepare('DELETE FROM upvotes WHERE user_id = ? AND item_id = ?').run(req.user.id, item.id);
  else db.prepare('INSERT INTO upvotes(user_id, item_id) VALUES (?, ?)').run(req.user.id, item.id);
  const n = db.prepare('SELECT COUNT(*) AS n FROM upvotes WHERE item_id = ?').get(item.id).n;
  res.json({ upvoted: !exists, upvotes: n });
});

app.put('/api/items/:id/collections', (req, res) => {
  const item = getItemOr404(req.params.id);
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(int).filter(Boolean);
  tx(() => {
    db.prepare('DELETE FROM collection_items WHERE item_id = ?').run(item.id);
    const ins = db.prepare('INSERT OR IGNORE INTO collection_items(collection_id, item_id) VALUES (?, ?)');
    for (const c of ids) if (db.prepare('SELECT 1 FROM collections WHERE id = ?').get(c)) ins.run(c, item.id);
  });
  res.json({ item: itemDetail(item.id, req.user.id) });
});

// ---------- Resources (prompts / tools / links) ----------
function readResource(body) {
  const kind = Object.keys(RESOURCE_KINDS).includes(body.kind) ? body.kind : 'link';
  const r = { kind, title: s(body.title, 200), content: s(body.content, 50000), url: validUrlOrEmpty(body.url) };
  if (!r.title && !r.content && !r.url) throw bad('Add a title, the prompt text, or a link.');
  return r;
}

app.post('/api/items/:id/resources', (req, res) => {
  const item = getItemOr404(req.params.id);
  const r = readResource(req.body || {});
  db.prepare('INSERT INTO resources(item_id, kind, title, content, url, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(item.id, r.kind, r.title, r.content, r.url, req.user.id);
  // Getting the resource usually means the "comment for the prompt" loop is closed.
  if (['need_comment', 'requested'].includes(item.resource_status)) db.prepare("UPDATE items SET resource_status = 'received' WHERE id = ?").run(item.id);
  res.status(201).json({ item: itemDetail(item.id, req.user.id) });
});

app.patch('/api/resources/:rid', (req, res) => {
  const row = db.prepare('SELECT * FROM resources WHERE id = ?').get(int(req.params.rid));
  if (!row) throw new HttpError(404, 'Resource not found.');
  const r = readResource({ ...row, ...req.body });
  db.prepare('UPDATE resources SET kind = ?, title = ?, content = ?, url = ? WHERE id = ?').run(r.kind, r.title, r.content, r.url, row.id);
  res.json({ item: itemDetail(row.item_id, req.user.id) });
});

app.delete('/api/resources/:rid', (req, res) => {
  const row = db.prepare('SELECT * FROM resources WHERE id = ?').get(int(req.params.rid));
  if (!row) throw new HttpError(404, 'Resource not found.');
  db.prepare('DELETE FROM resources WHERE id = ?').run(row.id);
  res.json({ item: itemDetail(row.item_id, req.user.id) });
});

// ---------- Attachments ----------
app.post('/api/items/:id/attachments', upload.array('files', 10), (req, res) => {
  let item;
  try { item = getItemOr404(req.params.id); } catch (e) { cleanupUploaded(req.files); throw e; }
  if (!(req.files || []).length) throw bad('Choose at least one file.');
  const saved = saveAttachments(item.id, req.files, req.user.id);
  if (!item.media_path) {
    const main = saved.find(x => x.mime.startsWith('video/')) || (!item.canonical_url && saved.find(x => x.mime.startsWith('image/')));
    if (main) db.prepare("UPDATE items SET media_path = ?, media_mime = ?, media_source = 'upload' WHERE id = ?").run(main.rel, main.mime, item.id);
  }
  res.status(201).json({ item: itemDetail(item.id, req.user.id) });
});

app.delete('/api/attachments/:aid', (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(int(req.params.aid));
  if (!a) throw new HttpError(404, 'File not found.');
  const item = getItemOr404(a.item_id);
  tx(() => {
    db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
    if (item.media_path === a.file_path) {
      const next = db.prepare("SELECT file_path, mime FROM attachments WHERE item_id = ? AND (mime LIKE 'video/%' OR mime LIKE 'image/%') ORDER BY id LIMIT 1").get(item.id);
      db.prepare("UPDATE items SET media_path = ?, media_mime = ?, media_source = ? WHERE id = ?")
        .run(next?.file_path || null, next?.mime || null, next ? 'upload' : null, item.id);
    }
  });
  removeDataFile(a.file_path);
  res.json({ item: itemDetail(item.id, req.user.id) });
});

// ---------- Comments ----------
app.post('/api/items/:id/comments', (req, res) => {
  const item = getItemOr404(req.params.id);
  const body = s(req.body.body, 4000);
  if (!body) throw bad('Write something first.');
  db.prepare('INSERT INTO comments(item_id, user_id, body) VALUES (?, ?, ?)').run(item.id, req.user.id, body);
  res.status(201).json({ item: itemDetail(item.id, req.user.id) });
});

app.delete('/api/comments/:cid', (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(int(req.params.cid));
  if (!c) throw new HttpError(404, 'Comment not found.');
  if (c.user_id !== req.user.id && req.user.role !== 'admin') throw new HttpError(403, 'You can only delete your own comments.');
  db.prepare('DELETE FROM comments WHERE id = ?').run(c.id);
  res.json({ item: itemDetail(c.item_id, req.user.id) });
});

// ---------- Libraries: unified resources (prompts, links & tools) ----------
function queryUnifiedResources(q = '') {
  const rows = db.prepare(`
    SELECT r.id, r.kind, r.title, r.content, r.url, r.created_at,
           i.id AS item_id, i.title AS item_title, COALESCE(i.canonical_url, i.url) AS item_url,
           i.platform, i.category, i.summary AS item_summary, i.what_it_does AS item_usage,
           u.name AS author
    FROM resources r
    JOIN items i ON i.id = r.item_id
    LEFT JOIN users u ON u.id = r.created_by
    WHERE i.status != 'archived'
    ORDER BY r.id DESC
  `).all();

  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const dedupKey = `${r.item_id}::${(r.url || '').toLowerCase()}::${(r.title || '').toLowerCase()}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const isPrompt = r.kind === 'prompt';
    let description = '';
    if (isPrompt) {
      description = r.item_summary || r.item_usage || 'Structured AI prompt ready to copy and run.';
    } else if (r.content && r.content.length <= 240) {
      description = r.content;
    } else {
      description = r.item_summary || r.item_usage || 'Shared tool or resource link.';
    }

    out.push({
      id: r.id,
      kind: r.kind,
      title: r.title || r.item_title || 'Shared Resource',
      description,
      content: r.content || '',
      prompt_text: isPrompt ? (r.content || '') : '',
      url: r.url || '',
      item_id: r.item_id,
      item_title: r.item_title,
      item_url: r.item_url || '',
      platform: r.platform,
      category: r.category,
      author: r.author || 'Team',
      created_at: r.created_at,
      source: 'team',
    });
  }

  if (!q) return out;
  const ql = q.toLowerCase();
  return out.filter(x => `${x.title} ${x.description} ${x.url} ${x.item_title} ${x.category}`.toLowerCase().includes(ql));
}

app.get('/api/library/resources', (req, res) => {
  const q = s(req.query.q, 200);
  res.json({ resources: queryUnifiedResources(q) });
});

app.get('/api/library/prompts', (req, res) => {
  const q = s(req.query.q, 200);
  const all = queryUnifiedResources(q).filter(r => r.kind === 'prompt');
  res.json({ prompts: all });
});

app.get('/api/library/hooks', (req, res) => {
  const q = s(req.query.q, 200).toLowerCase();
  const out = [];
  for (const i of db.prepare(`SELECT i.id, i.title, i.platform, i.content_type, i.category, i.thumb_path, i.ai_json, i.usefulness, i.created_at FROM items i WHERE i.ai_json IS NOT NULL ORDER BY COALESCE(i.usefulness,0) DESC, i.id DESC`).all()) {
    const ai = parseAi(i);
    if (!ai || !ai.hook || !ai.hook.text) continue;
    out.push({
      item_id: i.id, item_title: i.title, platform: i.platform, content_type: i.content_type, category: i.category, thumb: fileUrl(i.thumb_path), usefulness: i.usefulness,
      hook: ai.hook, payoff: ai.payoff, cta: ai.cta, story: ai.story?.structure || '', bangla_hooks: [],
    });
  }
  const filtered = q ? out.filter(x => JSON.stringify(x).toLowerCase().includes(q)) : out;
  res.json({ hooks: filtered });
});

app.get('/api/library/tools', (req, res) => {
  const q = s(req.query.q, 200);
  const all = queryUnifiedResources(q).filter(r => r.kind !== 'prompt');
  res.json({ tools: all });
});

app.get('/api/search-suggestions', (req, res) => {
  const q = s(req.query.q, 100).toLowerCase().trim();
  const items = db.prepare("SELECT id, title, category, platform, summary FROM items WHERE status != 'archived' ORDER BY id DESC LIMIT 50").all();
  const resources = queryUnifiedResources('');
  const tagRows = db.prepare('SELECT tag, COUNT(*) AS n FROM item_tags GROUP BY tag ORDER BY n DESC, tag LIMIT 50').all();

  const keywordSet = new Set([
    'Claude',
    'Motion Graphics',
    'Documentary',
    'AI Tools',
    'YouTube Automation',
    'AI Agent',
    'GitHub Repository',
    'Google Doc Prompt',
    '3D Animation',
    'Agent Reach',
    'YouTube Agent Skill',
  ]);
  for (const t of tagRows) {
    if (t.tag && t.tag.length > 2) keywordSet.add(t.tag);
  }
  for (const it of items) {
    if (it.category) keywordSet.add(it.category);
  }

  const keywords = [...keywordSet].filter(kw => !q || kw.toLowerCase().includes(q)).slice(0, 8);
  const matchedCategories = CATEGORIES.filter(c => c !== 'Other' && (!q || c.toLowerCase().includes(q))).slice(0, 5);
  const matchedItems = items
    .filter(it => !q || `${it.title} ${it.category} ${it.summary} ${it.platform}`.toLowerCase().includes(q))
    .slice(0, 5)
    .map(it => ({ id: it.id, title: it.title, category: it.category, platform: it.platform }));
  const matchedResources = resources
    .filter(r => !q || `${r.title} ${r.description} ${r.url}`.toLowerCase().includes(q))
    .slice(0, 4)
    .map(r => ({ id: r.id, item_id: r.item_id, title: r.title, kind: r.kind, url: r.url }));

  res.json({
    keywords,
    categories: matchedCategories,
    items: matchedItems,
    resources: matchedResources,
  });
});

app.get('/api/tags', (_req, res) => {
  res.json({ tags: db.prepare('SELECT tag, COUNT(*) AS n FROM item_tags GROUP BY tag ORDER BY n DESC, tag LIMIT 200').all() });
});

app.get('/api/stats', (req, res) => {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const allRes = queryUnifiedResources('');
  res.json({
    total: one("SELECT COUNT(*) AS n FROM items WHERE status != 'archived'").n,
    thisWeek: one("SELECT COUNT(*) AS n FROM items WHERE created_at >= datetime('now','-7 days')").n,
    pending: one("SELECT COUNT(*) AS n FROM items WHERE resource_status IN ('need_comment','requested') AND status != 'archived'").n,
    testing: one("SELECT COUNT(*) AS n FROM items WHERE status = 'testing'").n,
    used: one("SELECT COUNT(*) AS n FROM items WHERE status = 'used'").n,
    prompts: allRes.filter(r => r.kind === 'prompt').length,
    resources: allRes.length,
    favorites: one('SELECT COUNT(*) AS n FROM favorites WHERE user_id = ?', req.user.id).n,
    myShared: one("SELECT COUNT(*) AS n FROM items WHERE shared_by = ? AND status != 'archived'", req.user.id).n,
    analyzing: queueSize(),
    byPlatform: db.prepare("SELECT platform, COUNT(*) AS n FROM items WHERE status != 'archived' GROUP BY platform ORDER BY n DESC").all(),
    byCategory: db.prepare("SELECT category, COUNT(*) AS n FROM items WHERE status != 'archived' GROUP BY category ORDER BY n DESC").all(),
    byType: db.prepare("SELECT content_type, COUNT(*) AS n FROM items WHERE status != 'archived' GROUP BY content_type ORDER BY n DESC").all(),
    sharers: req.user.role === 'admin'
      ? db.prepare('SELECT u.id, u.name, u.color, COUNT(i.id) AS n FROM users u LEFT JOIN items i ON i.shared_by = u.id GROUP BY u.id ORDER BY n DESC, u.name').all()
      : [],
  });
});

// ---------- Collections ----------
app.get('/api/collections', (_req, res) => {
  const rows = db.prepare(`SELECT c.*, u.name AS creator, (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) AS n
    FROM collections c LEFT JOIN users u ON u.id = c.created_by ORDER BY c.name COLLATE NOCASE`).all();
  const thumbs = db.prepare(`SELECT i.thumb_path FROM collection_items ci JOIN items i ON i.id = ci.item_id WHERE ci.collection_id = ? AND i.thumb_path IS NOT NULL ORDER BY ci.added_at DESC LIMIT 4`);
  res.json({ collections: rows.map(c => ({ ...c, thumbs: thumbs.all(c.id).map(t => fileUrl(t.thumb_path)) })) });
});

app.post('/api/collections', (req, res) => {
  const name = s(req.body.name, 80);
  if (!name) throw bad('Give the collection a name.');
  if (db.prepare('SELECT 1 FROM collections WHERE name = ? COLLATE NOCASE').get(name)) throw bad('A collection with this name already exists.');
  const r = db.prepare('INSERT INTO collections(name, description, emoji, created_by) VALUES (?, ?, ?, ?)').run(name, s(req.body.description, 500), s(req.body.emoji, 8) || '📁', req.user.id);
  res.status(201).json({ collection: db.prepare('SELECT * FROM collections WHERE id = ?').get(Number(r.lastInsertRowid)) });
});

app.patch('/api/collections/:cid', (req, res) => {
  const c = db.prepare('SELECT * FROM collections WHERE id = ?').get(int(req.params.cid));
  if (!c) throw new HttpError(404, 'Collection not found.');
  const name = 'name' in req.body ? s(req.body.name, 80) : c.name;
  if (!name) throw bad('Name cannot be empty.');
  const clash = db.prepare('SELECT 1 FROM collections WHERE name = ? COLLATE NOCASE AND id != ?').get(name, c.id);
  if (clash) throw bad('A collection with this name already exists.');
  db.prepare('UPDATE collections SET name = ?, description = ?, emoji = ? WHERE id = ?').run(
    name, 'description' in req.body ? s(req.body.description, 500) : c.description, 'emoji' in req.body ? (s(req.body.emoji, 8) || '📁') : c.emoji, c.id);
  res.json({ collection: db.prepare('SELECT * FROM collections WHERE id = ?').get(c.id) });
});

app.delete('/api/collections/:cid', (req, res) => {
  const c = db.prepare('SELECT * FROM collections WHERE id = ?').get(int(req.params.cid));
  if (!c) throw new HttpError(404, 'Collection not found.');
  if (c.created_by !== req.user.id && req.user.role !== 'admin') throw new HttpError(403, 'Only the creator or an admin can delete this collection.');
  db.prepare('DELETE FROM collections WHERE id = ?').run(c.id);
  res.json({ ok: true });
});

// ---------- Team (Admin Only — Pritom) ----------
app.get('/api/team', requireAdmin, (_req, res) => {
  const members = db.prepare(`SELECT u.id, u.name, u.email, u.role, u.color, u.created_at,
      (SELECT COUNT(*) FROM items i WHERE i.shared_by = u.id) AS shared,
      (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id) AS comments
    FROM users u ORDER BY u.created_at`).all();
  res.json({ members, inviteCode: inviteCode() });
});

app.post('/api/team/invite/regenerate', requireAdmin, (_req, res) => {
  res.json({ inviteCode: newInviteCode() });
});

app.patch('/api/team/:uid', requireAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(int(req.params.uid));
  if (!u) throw new HttpError(404, 'User not found.');
  const role = req.body.role;
  if (!['admin', 'member'].includes(role)) throw bad('Unknown role.');
  if (u.role === 'admin' && role === 'member' && db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n <= 1) throw bad('There must be at least one admin.');
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, u.id);
  res.json({ ok: true });
});

app.delete('/api/team/:uid', requireAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(int(req.params.uid));
  if (!u) throw new HttpError(404, 'User not found.');
  if (u.id === req.user.id) throw bad('You cannot remove yourself.');
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id); // their items stay, "shared by" becomes empty
  res.json({ ok: true });
});

app.post('/api/team/:uid/reset-password', requireAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(int(req.params.uid));
  if (!u) throw new HttpError(404, 'User not found.');
  const temp = crypto.randomBytes(6).toString('base64url');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(temp), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  res.json({ password: temp });
});

// ---------- Export ----------
function csvCell(v) {
  const t = v == null ? '' : String(v);
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

app.get('/api/export.csv', (req, res) => {
  const rows = db.prepare(`${LIST_SELECT} ORDER BY i.id`).all({ me: req.user.id });
  const head = ['id', 'title', 'url', 'platform', 'type', 'category', 'status', 'resource_status', 'comment_keyword', 'summary', 'what_it_does', 'hook', 'usefulness', 'tags', 'shared_by', 'created_at', 'notes'];
  const lines = [head.join(',')];
  for (const r of rows) {
    lines.push([r.id, r.title, r.canonical_url || r.url, r.platform, r.content_type, r.category, r.status, r.resource_status, r.comment_keyword, r.summary, r.what_it_does, r.hook_text, r.usefulness,
      (r.tags || '').split('\u001f').join(' | '), r.sharer_name, r.created_at, r.notes].map(csvCell).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="bmdgl-vault-${nowIso().slice(0, 10)}.csv"`);
  res.send('\uFEFF' + lines.join('\r\n'));
});

app.get('/api/export.json', requireAdmin, (_req, res) => {
  const all = (t) => db.prepare(`SELECT * FROM ${t}`).all();
  res.setHeader('Content-Disposition', `attachment; filename="bmdgl-vault-backup-${nowIso().slice(0, 10)}.json"`);
  res.json({
    exported_at: nowIso(),
    users: db.prepare('SELECT id, name, email, role, created_at FROM users').all(),
    items: all('items'), item_tags: all('item_tags'), resources: all('resources'), attachments: all('attachments'),
    comments: all('comments'), collections: all('collections'), collection_items: all('collection_items'),
  });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

// ---------- Front-end ----------
app.use(express.static(config.publicDir, {
  index: 'index.html',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.get(/^\/(?!files\/|api\/).*/, (_req, res) => res.sendFile(path.join(config.publicDir, 'index.html')));

// ---------- Errors ----------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Something went wrong.';
  if (err instanceof multer.MulterError) {
    status = 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? `File is too large (max ${config.maxUploadMB} MB).` : `Upload error: ${err.message}`;
  } else if (err.type === 'entity.too.large') {
    status = 413; message = 'Request is too large.';
  } else if (status >= 500) {
    console.error('[error]', req.method, req.originalUrl, err);
    message = 'Server error. Please try again.';
  }
  if (req.originalUrl.startsWith('/api')) res.status(status).json({ error: message });
  else res.status(status).send(message);
});

// ---------- Boot ----------
export function start() {
  inviteCode();
  cleanupSessions();
  resumeInterrupted();
  setInterval(cleanupSessions, 6 * 3600 * 1000).unref();
  // remove leftover uploads older than a day that were never linked (failed requests)
  return app.listen(config.port, config.host, () => {
    console.log(`\n  ${config.appName} is running → http://localhost:${config.port}`);
    console.log(`  AI analysis: ${aiEnabled() ? `ON (${config.geminiModel})` : 'OFF - set GEMINI_API_KEY in .env'}`);
    console.log(`  Offline video copies (yt-dlp): ${config.hasYtdlp ? 'ON' : 'OFF - install yt-dlp'}   ffmpeg: ${config.hasFfmpeg ? 'ON' : 'OFF'}\n`);
  });
}

