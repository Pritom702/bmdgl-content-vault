import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
for (const d of ['media', 'thumbs', 'uploads', 'tmp']) fs.mkdirSync(path.join(config.dataDir, d), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  color TEXT NOT NULL DEFAULT '#2563EB',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT,
  canonical_url TEXT,
  platform TEXT NOT NULL DEFAULT 'web',
  content_type TEXT NOT NULL DEFAULT 'other',
  title TEXT NOT NULL DEFAULT '',
  title_source TEXT NOT NULL DEFAULT 'meta',
  category_locked INTEGER NOT NULL DEFAULT 0,
  duration REAL,
  author_name TEXT,
  author_url TEXT,
  caption TEXT,
  thumb_path TEXT,
  media_path TEXT,
  media_mime TEXT,
  media_source TEXT,
  notes TEXT,
  category TEXT NOT NULL DEFAULT 'Other',
  status TEXT NOT NULL DEFAULT 'new',
  resource_status TEXT NOT NULL DEFAULT 'none',
  comment_keyword TEXT,
  used_in_url TEXT,
  ai_status TEXT NOT NULL DEFAULT 'pending',
  ai_error TEXT,
  ai_source TEXT,
  ai_json TEXT,
  summary TEXT,
  what_it_does TEXT,
  hook_text TEXT,
  usefulness INTEGER,
  archive_status TEXT NOT NULL DEFAULT 'none',
  archive_error TEXT,
  shared_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_items_canon ON items(canonical_url);
CREATE INDEX IF NOT EXISTS idx_items_created ON items(created_at);
CREATE TABLE IF NOT EXISTS item_tags (
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY (item_id, tag)
);
CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'link',
  title TEXT NOT NULL DEFAULT '',
  content TEXT,
  url TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  original_name TEXT,
  mime TEXT,
  size INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, item_id)
);
CREATE TABLE IF NOT EXISTS upvotes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, item_id)
);
CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  emoji TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS collection_items (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (collection_id, item_id)
);
CREATE TABLE IF NOT EXISTS password_reset_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS categories (
  name TEXT PRIMARY KEY COLLATE NOCASE,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS preference_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS agent_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  summary TEXT NOT NULL,
  learned_preferences_json TEXT NOT NULL DEFAULT '[]',
  recommendations_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

export function ensureCategory(rawName, createdBy = 'agent') {
  const clean = String(rawName || '').replace(/\s+/g, ' ').trim().slice(0, 42);
  if (!clean || clean.length < 2) return 'Other';
  const existing = db.prepare('SELECT name FROM categories WHERE name = ? COLLATE NOCASE').get(clean);
  if (existing) return existing.name;
  db.prepare('INSERT OR IGNORE INTO categories(name, created_by) VALUES (?, ?)').run(clean, createdBy);
  return clean;
}

export function getAllCategories(baseCategories = []) {
  for (const c of baseCategories) {
    if (c && c !== 'Other') ensureCategory(c, 'system');
  }
  const itemCats = db.prepare("SELECT DISTINCT category FROM items WHERE category IS NOT NULL AND category != '' AND category != 'Other'").all();
  for (const r of itemCats) ensureCategory(r.category, 'agent');
  const rows = db.prepare('SELECT name, created_by, created_at FROM categories ORDER BY CASE WHEN created_by = \'agent\' THEN 0 ELSE 1 END, created_at DESC').all();
  const names = rows.map(r => r.name).filter(n => n.toLowerCase() !== 'other');
  const ordered = [];
  for (const b of baseCategories) {
    const match = names.find(n => n.toLowerCase() === b.toLowerCase());
    if (match && !ordered.includes(match)) ordered.push(match);
  }
  for (const n of names) {
    if (!ordered.includes(n)) ordered.push(n);
  }
  ordered.push('Other');
  return ordered;
}

export function logPreference(userId, action, detail) {
  try {
    db.prepare('INSERT INTO preference_logs(user_id, action, detail) VALUES (?, ?, ?)').run(userId || null, String(action), String(detail).slice(0, 1000));
  } catch { /* ignore */ }
}

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

/** Run fn inside a transaction. */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
