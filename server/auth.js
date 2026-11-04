import crypto from 'node:crypto';
import { db, getSetting, setSetting } from './db.js';
import { config } from './config.js';

const COOKIE = 'vault_session';
const TOKEN_SECRET = process.env.VAULT_SECRET || config.geminiKey || 'bmdgl-vault-secret-2026';
const COLORS = ['#2563EB', '#7C3AED', '#DB2777', '#EA580C', '#16A34A', '#0891B2', '#CA8A04', '#DC2626', '#4F46E5', '#0D9488'];

function signUserToken(userId, expiresIso) {
  const payload = `${userId}.${Date.parse(expiresIso)}`;
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  return `v1.${payload}.${sig}`;
}

function verifyUserToken(token) {
  if (!token || !token.startsWith('v1.')) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [, uidStr, expStr, sig] = parts;
  const payload = `${uidStr}.${expStr}`;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  if (sig !== expected) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= Date.now()) return null;
  return Number(uidStr);
}

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  try {
    const [algo, saltHex, hashHex] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length);
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function inviteCode() {
  let code = getSetting('invite_code');
  if (!code) {
    code = newInviteCode();
    setSetting('invite_code', code);
  }
  return code;
}

export function newInviteCode() {
  const code = 'BMDGL-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  setSetting('invite_code', code);
  return code;
}

export function userCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

export function createUser({ name, email, password, role }) {
  const color = COLORS[userCount() % COLORS.length];
  const info = db.prepare('INSERT INTO users(name, email, password_hash, role, color) VALUES (?, ?, ?, ?, ?)')
    .run(name, email, hashPassword(password), role, color);
  return Number(info.lastInsertRowid);
}

export function createSession(res, userId) {
  const expires = new Date(Date.now() + config.sessionDays * 864e5);
  const token = signUserToken(userId, expires.toISOString());
  try {
    db.prepare('INSERT OR REPLACE INTO sessions(token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires.toISOString());
  } catch { /* ignore */ }
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    expires,
    path: '/',
  });
}

export function destroySession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) {
    try { db.prepare('DELETE FROM sessions WHERE token = ?').run(token); } catch { /* ignore */ }
  }
  res.clearCookie(COOKIE, { path: '/' });
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function publicUser(u) {
  return u ? { id: u.id, name: u.name, email: u.email, role: u.role, color: u.color } : null;
}

/** Attaches req.user if the session cookie is valid. */
export function loadUser(req, _res, next) {
  const token = readCookie(req, COOKIE);
  req.user = null;
  if (token) {
    const signedUid = verifyUserToken(token);
    if (signedUid) {
      req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(signedUid) || null;
    } else {
      const row = db.prepare(`SELECT u.* , s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token);
      if (row && new Date(row.expires_at) > new Date()) req.user = row;
      else if (row) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }
  }
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can do that.' });
  next();
}

/** Very small in-memory rate limiter for auth endpoints. */
const attempts = new Map();
export function rateLimit(key, max = 10, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const rec = attempts.get(key) || { n: 0, reset: now + windowMs };
  if (now > rec.reset) { rec.n = 0; rec.reset = now + windowMs; }
  rec.n += 1;
  attempts.set(key, rec);
  return rec.n <= max;
}

export function cleanupSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
}

