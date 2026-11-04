import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { config } from './config.js';
import { fetchWithTimeout, runYtdlp, ytdlpArgs } from './metadata.js';

const MEDIA_DIR = path.join(config.dataDir, 'media');
const THUMB_DIR = path.join(config.dataDir, 'thumbs');

const EXT_BY_MIME = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif',
};

export const MIME_BY_EXT = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
};

export function mimeFor(file) {
  return MIME_BY_EXT[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

/** Download a remote thumbnail and store it locally (remote CDN links from IG/FB expire). Returns relative path or null. */
export async function saveThumbnail(itemId, url) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 15000);
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = EXT_BY_MIME[type];
    if (!ext) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 500 || buf.length > 8 * 1024 * 1024) return null;
    const name = `item-${itemId}-${Date.now()}${ext}`;
    fs.writeFileSync(path.join(THUMB_DIR, name), buf);
    return `thumbs/${name}`;
  } catch {
    return null;
  }
}

/** Grab a frame from a local video with ffmpeg. Returns relative path or null. */
export function thumbnailFromVideo(itemId, videoRelPath) {
  if (!config.hasFfmpeg || !videoRelPath) return Promise.resolve(null);
  const input = path.join(config.dataDir, videoRelPath);
  const name = `item-${itemId}-${Date.now()}.jpg`;
  const output = path.join(THUMB_DIR, name);
  return new Promise((resolve) => {
    execFile(config.ffmpegBin, ['-y', '-ss', '1', '-i', input, '-frames:v', '1', '-vf', 'scale=720:-2', '-q:v', '4', output],
      { timeout: 60000, windowsHide: true }, (err) => {
        if (err || !fs.existsSync(output)) {
          // Very short clips: retry at t=0
          execFile(config.ffmpegBin, ['-y', '-i', input, '-frames:v', '1', '-vf', 'scale=720:-2', '-q:v', '4', output],
            { timeout: 60000, windowsHide: true }, (err2) => resolve(!err2 && fs.existsSync(output) ? `thumbs/${name}` : null));
        } else resolve(`thumbs/${name}`);
      });
  });
}

/**
 * Save an offline copy of the video with yt-dlp so it plays in the Vault even if
 * the original embed is blocked, private or deleted. Returns { relPath, mime }.
 */
export async function archiveVideo(itemId, url) {
  if (!config.hasYtdlp) throw new Error('yt-dlp is not installed on the server.');
  // Remove older copies of this item
  for (const f of fs.readdirSync(MEDIA_DIR)) if (f.startsWith(`item-${itemId}.`)) fs.rmSync(path.join(MEDIA_DIR, f), { force: true });

  const format = config.hasFfmpeg
    ? 'bv*[height<=720][vcodec^=avc]+ba[ext=m4a]/bv*[height<=720]+ba/b[height<=720]/bv*+ba/b'
    : 'b[height<=720][ext=mp4]/b[ext=mp4]/b';
  const args = ytdlpArgs([
    '-f', format,
    '--max-filesize', `${config.maxArchiveMB}M`,
    '-o', path.join(MEDIA_DIR, `item-${itemId}.%(ext)s`),
    '--print', 'after_move:filepath',
    '--no-part',
  ]);
  if (config.hasFfmpeg) args.push('--merge-output-format', 'mp4', '--ffmpeg-location', config.ffmpegBin);
  args.push(url);
  const out = await runYtdlp(args, 15 * 60 * 1000);
  const lines = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  let file = lines.reverse().find(l => fs.existsSync(l));
  if (!file) {
    const found = fs.readdirSync(MEDIA_DIR).find(f => f.startsWith(`item-${itemId}.`));
    if (found) file = path.join(MEDIA_DIR, found);
  }
  if (!file) throw new Error(`No file was downloaded (video may be private, need login cookies, or exceed ${config.maxArchiveMB} MB).`);
  const rel = `media/${path.basename(file)}`;
  return { relPath: rel, mime: mimeFor(file) };
}

export function absData(rel) {
  if (!rel) return null;
  const p = path.resolve(config.dataDir, rel);
  if (!p.startsWith(path.resolve(config.dataDir) + path.sep)) return null; // path traversal guard
  return p;
}

export function removeDataFile(rel) {
  const p = absData(rel);
  if (p) fs.rmSync(p, { force: true });
}

