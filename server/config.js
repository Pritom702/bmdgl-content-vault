import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

// Load .env if present (Node >= 21.7). Real environment variables win.
try {
  const envFile = path.join(ROOT, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
} catch (e) {
  console.warn('[config] Could not read .env:', e.message);
}

function bool(v, d) {
  if (v === undefined || v === '') return d;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function hasBinary(cmd, args = ['--version']) {
  try {
    execFileSync(cmd, args, { stdio: 'ignore', timeout: 15000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

const isVercel = Boolean(process.env.VERCEL);
const dataDir = isVercel
  ? path.resolve('/tmp', 'bmdgl-vault-data')
  : path.resolve(ROOT, process.env.DATA_DIR || 'data');
const ytdlpBin = process.env.YTDLP_PATH || 'yt-dlp';
const ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg';

export const config = {
  isVercel,
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  dataDir,
  bundledDataDir: path.resolve(ROOT, 'data'),
  dbPath: path.join(dataDir, 'vault.db'),
  publicDir: path.join(ROOT, 'public'),
  appName: process.env.APP_NAME || 'BMDGL Content Vault',
  geminiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  ytdlpBin,
  ffmpegBin,
  ytdlpCookies: process.env.YTDLP_COOKIES || '',
  hasYtdlp: isVercel ? false : (bool(process.env.DISABLE_YTDLP, false) ? false : hasBinary(ytdlpBin)),
  hasFfmpeg: isVercel ? false : hasBinary(ffmpegBin, ['-version']),
  autoArchive: bool(process.env.AUTO_ARCHIVE, true),
  maxArchiveMB: parseInt(process.env.MAX_ARCHIVE_MB || '150', 10),
  maxUploadMB: parseInt(process.env.MAX_UPLOAD_MB || '300', 10),
  secureCookies: bool(process.env.SECURE_COOKIES, isVercel),
  sessionDays: 3650,
};

