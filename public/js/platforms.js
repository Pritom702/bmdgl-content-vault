// Shared by the browser (public/) and the server (imported from server/*.js).
// Pure functions only - no DOM, no Node APIs.

export const PLATFORMS = {
  youtube:   { label: 'YouTube',     color: '#FF0033' },
  instagram: { label: 'Instagram',   color: '#E1306C' },
  facebook:  { label: 'Facebook',    color: '#1877F2' },
  tiktok:    { label: 'TikTok',      color: '#111111' },
  x:         { label: 'X / Twitter', color: '#0F1419' },
  linkedin:  { label: 'LinkedIn',    color: '#0A66C2' },
  threads:   { label: 'Threads',     color: '#101010' },
  drive:     { label: 'Google Drive',color: '#1FA463' },
  vimeo:     { label: 'Vimeo',       color: '#1AB7EA' },
  loom:      { label: 'Loom',        color: '#625DF5' },
  skool:     { label: 'Skool',       color: '#F8B500' },
  file:      { label: 'Direct file', color: '#64748B' },
  upload:    { label: 'Uploaded',    color: '#7C3AED' },
  web:       { label: 'Website',     color: '#475569' },
};

export const CONTENT_TYPES = {
  reel: 'Reel', short: 'Short', video: 'Video', post: 'Post', carousel: 'Carousel',
  image: 'Image', tool: 'Tool', prompt: 'Prompt', folder: 'Drive folder', doc: 'Document',
  course: 'Course / Community', article: 'Article', thread: 'Thread', other: 'Other',
};

export const CATEGORIES = [
  'Motion Graphics & Documentary',
  'AI Tools',
  'Prompts',
  'Video Editing',
  'Hooks & Copywriting',
  'Storytelling & Scripts',
  'Design & Thumbnails',
  'Automation',
  'Ads & Funnels',
  'Growth Strategy',
  'Sales & Business',
  'Other',
];

export const STATUSES = {
  new: 'New',
  testing: 'Testing',
  used: 'Used in our content',
  archived: 'Archived',
};

export const RESOURCE_STATUSES = {
  none: 'No resource needed',
  need_comment: 'Need to comment / DM',
  requested: 'Requested - waiting',
  received: 'Received',
};

export const RESOURCE_KINDS = {
  prompt: 'Prompt',
  tool: 'Tool / App',
  drive: 'Drive / Folder',
  skool: 'Skool / Community',
  link: 'Link',
  note: 'Note / Steps',
};

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif)(\?|#|$)/i;
const PDF_EXT = /\.pdf(\?|#|$)/i;

/** Pull the first http(s) URL out of arbitrary text (e.g. text shared from the Instagram app). */
export function extractUrl(text) {
  if (!text) return null;
  const m = String(text).match(/https?:\/\/[^\s<>"'`]+/i);
  if (!m) return null;
  return m[0].replace(/[),.;!?\]]+$/, '');
}

export function safeParseUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) {
    if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(s)) s = 'https://' + s; else return null;
  }
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u;
  } catch {
    return null;
  }
}

function host(u) {
  return u.hostname.toLowerCase().replace(/^(www\.|m\.|mobile\.|web\.|mbasic\.)/, '');
}

/**
 * Analyse a URL and return everything the UI needs to show it in-app.
 * {
 *   platform, contentType, id, canonicalUrl,
 *   embed: { kind: 'iframe'|'video'|'image'|'none', src, aspect: '9/16'|'16/9'|'4/5'|'1/1'|'auto', height? }
 * }
 */
export function analyzeUrl(raw) {
  const u = safeParseUrl(raw);
  if (!u) return null;
  const h = host(u);
  const path = u.pathname.replace(/\/+$/, '') || '/';
  const parts = path.split('/').filter(Boolean);
  const res = {
    platform: 'web',
    contentType: 'article',
    id: null,
    canonicalUrl: u.toString(),
    embed: { kind: 'none', src: null, aspect: '16/9' },
    needsResolve: false,
  };

  // ---------- YouTube ----------
  if (h === 'youtube.com' || h === 'music.youtube.com' || h === 'youtu.be' || h === 'youtube-nocookie.com') {
    res.platform = 'youtube';
    let id = null; let short = false;
    if (h === 'youtu.be') id = parts[0];
    else if (parts[0] === 'watch') id = u.searchParams.get('v');
    else if (['shorts', 'embed', 'live', 'v', 'e'].includes(parts[0])) { id = parts[1]; short = parts[0] === 'shorts'; }
    if (id && /^[\w-]{11}$/.test(id)) {
      res.id = id;
      res.contentType = short ? 'short' : 'video';
      res.canonicalUrl = short ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`;
      const t = u.searchParams.get('t') || u.searchParams.get('start');
      const start = t ? parseInt(String(t).replace(/s$/, ''), 10) : 0;
      res.embed = {
        kind: 'iframe',
        src: `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1${start > 0 ? `&start=${start}` : ''}`,
        aspect: short ? '9/16' : '16/9',
      };
    } else {
      res.contentType = 'other';
    }
    return res;
  }

  // ---------- Instagram ----------
  if (h === 'instagram.com' || h === 'instagr.am') {
    res.platform = 'instagram';
    // /p/CODE, /reel/CODE, /reels/CODE, /tv/CODE, also /username/p/CODE and /username/reel/CODE
    let idx = parts.findIndex(p => ['p', 'reel', 'reels', 'tv'].includes(p));
    if (idx !== -1 && parts[idx + 1]) {
      const kind = parts[idx];
      const code = parts[idx + 1];
      res.id = code;
      const isReel = kind !== 'p';
      res.contentType = isReel ? 'reel' : 'post';
      const seg = isReel ? 'reel' : 'p';
      res.canonicalUrl = `https://www.instagram.com/${seg}/${code}/`;
      res.embed = {
        kind: 'iframe',
        src: `https://www.instagram.com/${seg}/${code}/embed/captioned/`,
        aspect: 'auto',
        height: isReel ? 760 : 700,
      };
    } else {
      res.contentType = parts[0] === 'stories' ? 'other' : 'other';
      res.canonicalUrl = `https://www.instagram.com${path === '/' ? '/' : path + '/'}`;
    }
    return res;
  }

  // ---------- Facebook ----------
  if (h === 'facebook.com' || h === 'fb.com' || h === 'fb.watch' || h === 'business.facebook.com') {
    res.platform = 'facebook';
    const clean = new URL(u.toString());
    clean.hostname = 'www.facebook.com';
    // strip tracking params but keep the ones that identify content
    const keep = ['v', 'story_fbid', 'id', 'fbid', 'set'];
    for (const k of [...clean.searchParams.keys()]) if (!keep.includes(k)) clean.searchParams.delete(k);
    clean.hash = '';
    let href = clean.toString();

    let isVideo = false; let isReel = false;
    if (h === 'fb.watch') { isVideo = true; res.needsResolve = true; href = u.toString(); }
    else if (parts[0] === 'share') {
      // /share/r/X (reel), /share/v/X (video), /share/p/X (post), /share/X
      res.needsResolve = true;
      isReel = parts[1] === 'r';
      isVideo = parts[1] === 'r' || parts[1] === 'v';
      href = u.toString();
    }
    else if (parts[0] === 'reel' || parts[0] === 'reels') { isReel = true; isVideo = true; res.id = parts[1] || null; if (res.id) href = `https://www.facebook.com/reel/${res.id}`; }
    else if (parts[0] === 'watch') { isVideo = true; res.id = u.searchParams.get('v'); }
    else if (parts.includes('videos')) { isVideo = true; res.id = parts[parts.indexOf('videos') + 1] || null; }

    res.canonicalUrl = href;
    if (isVideo) {
      res.contentType = isReel ? 'reel' : 'video';
      res.embed = {
        kind: 'iframe',
        src: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(href)}&show_text=false&width=500`,
        aspect: isReel ? '9/16' : '16/9',
      };
    } else if (parts.length) {
      res.contentType = 'post';
      res.embed = {
        kind: 'iframe',
        src: `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(href)}&show_text=true&width=500`,
        aspect: 'auto',
        height: 720,
      };
    } else {
      res.contentType = 'other';
    }
    return res;
  }

  // ---------- TikTok ----------
  if (h === 'tiktok.com' || h.endsWith('.tiktok.com')) {
    res.platform = 'tiktok';
    const vi = parts.indexOf('video');
    const pi = parts.indexOf('photo');
    if (vi !== -1 && /^\d+$/.test(parts[vi + 1] || '')) {
      res.id = parts[vi + 1];
      res.contentType = 'short';
      res.canonicalUrl = `https://www.tiktok.com/${parts[0]}/video/${res.id}`;
      res.embed = { kind: 'iframe', src: `https://www.tiktok.com/embed/v2/${res.id}`, aspect: 'auto', height: 760 };
    } else if (pi !== -1 && /^\d+$/.test(parts[pi + 1] || '')) {
      res.id = parts[pi + 1];
      res.contentType = 'carousel';
      res.canonicalUrl = `https://www.tiktok.com/${parts[0]}/photo/${res.id}`;
      res.embed = { kind: 'iframe', src: `https://www.tiktok.com/embed/v2/${res.id}`, aspect: 'auto', height: 760 };
    } else {
      res.contentType = 'short';
      res.needsResolve = h === 'vm.tiktok.com' || h === 'vt.tiktok.com' || parts[0] === 't';
    }
    return res;
  }

  // ---------- X / Twitter ----------
  if (h === 'x.com' || h === 'twitter.com' || h === 'mobile.twitter.com') {
    res.platform = 'x';
    const si = parts.indexOf('status');
    if (si !== -1 && /^\d+$/.test(parts[si + 1] || '')) {
      res.id = parts[si + 1];
      res.contentType = 'post';
      res.canonicalUrl = `https://x.com/${parts[0]}/status/${res.id}`;
      res.embed = { kind: 'iframe', src: `https://platform.twitter.com/embed/Tweet.html?id=${res.id}&dnt=true`, aspect: 'auto', height: 640 };
    } else res.contentType = 'other';
    return res;
  }

  // ---------- Threads ----------
  if (h === 'threads.net' || h === 'threads.com') {
    res.platform = 'threads';
    const pi = parts.indexOf('post');
    if (pi !== -1 && parts[pi + 1] && parts[0]?.startsWith('@')) {
      res.id = parts[pi + 1];
      res.contentType = 'thread';
      res.canonicalUrl = `https://www.threads.net/${parts[0]}/post/${res.id}`;
      res.embed = { kind: 'iframe', src: `https://www.threads.net/${parts[0]}/post/${res.id}/embed`, aspect: 'auto', height: 640 };
    } else res.contentType = 'other';
    return res;
  }

  // ---------- LinkedIn ----------
  if (h === 'linkedin.com' || h.endsWith('.linkedin.com')) {
    res.platform = 'linkedin';
    res.contentType = 'post';
    const s = decodeURIComponent(u.pathname);
    const urn = s.match(/urn:li:(activity|share|ugcPost):(\d+)/);
    const act = s.match(/activity-(\d{10,})/);
    let urnStr = null;
    if (urn) urnStr = `urn:li:${urn[1]}:${urn[2]}`;
    else if (act) urnStr = `urn:li:activity:${act[1]}`;
    if (urnStr) {
      res.id = urnStr;
      res.embed = { kind: 'iframe', src: `https://www.linkedin.com/embed/feed/update/${urnStr}`, aspect: 'auto', height: 640 };
    }
    return res;
  }

  // ---------- Google Drive / Docs ----------
  if (h === 'drive.google.com' || h === 'docs.google.com') {
    res.platform = 'drive';
    const full = u.pathname;
    let m;
    if ((m = full.match(/\/folders\/([\w-]{10,})/))) {
      res.id = m[1]; res.contentType = 'folder';
      res.canonicalUrl = `https://drive.google.com/drive/folders/${m[1]}`;
      res.embed = { kind: 'iframe', src: `https://drive.google.com/embeddedfolderview?id=${m[1]}#grid`, aspect: 'auto', height: 520 };
    } else if ((m = full.match(/\/file\/d\/([\w-]{10,})/)) || (u.searchParams.get('id') && (m = [null, u.searchParams.get('id')]))) {
      res.id = m[1]; res.contentType = 'doc';
      res.canonicalUrl = `https://drive.google.com/file/d/${m[1]}/view`;
      res.embed = { kind: 'iframe', src: `https://drive.google.com/file/d/${m[1]}/preview`, aspect: '16/9' };
    } else if ((m = full.match(/\/(document|spreadsheets|presentation|forms)\/d\/([\w-]{10,})/))) {
      const kind = m[1]; const id = m[2];
      res.id = id; res.contentType = 'doc';
      res.canonicalUrl = `https://docs.google.com/${kind}/d/${id}/edit`;
      const src = kind === 'presentation' ? `https://docs.google.com/presentation/d/${id}/embed`
        : kind === 'forms' ? `https://docs.google.com/forms/d/${id}/viewform?embedded=true`
        : `https://docs.google.com/${kind}/d/${id}/preview`;
      res.embed = { kind: 'iframe', src, aspect: 'auto', height: 640 };
    } else res.contentType = 'folder';
    return res;
  }

  // ---------- Vimeo ----------
  if (h === 'vimeo.com' || h === 'player.vimeo.com') {
    res.platform = 'vimeo';
    const id = parts.find(p => /^\d{5,}$/.test(p));
    if (id) {
      res.id = id; res.contentType = 'video';
      res.canonicalUrl = `https://vimeo.com/${id}`;
      res.embed = { kind: 'iframe', src: `https://player.vimeo.com/video/${id}`, aspect: '16/9' };
    }
    return res;
  }

  // ---------- Loom ----------
  if (h === 'loom.com') {
    res.platform = 'loom';
    if ((parts[0] === 'share' || parts[0] === 'embed') && parts[1]) {
      res.id = parts[1]; res.contentType = 'video';
      res.canonicalUrl = `https://www.loom.com/share/${parts[1]}`;
      res.embed = { kind: 'iframe', src: `https://www.loom.com/embed/${parts[1]}`, aspect: '16/9' };
    }
    return res;
  }

  // ---------- Skool ----------
  if (h === 'skool.com' || h.endsWith('.skool.com')) {
    res.platform = 'skool';
    res.contentType = 'course';
    return res; // Skool blocks iframes - shown as a rich link card.
  }

  // ---------- Direct files ----------
  if (VIDEO_EXT.test(u.pathname)) {
    res.platform = 'file'; res.contentType = 'video';
    res.embed = { kind: 'video', src: u.toString(), aspect: '16/9' };
    return res;
  }
  if (IMAGE_EXT.test(u.pathname)) {
    res.platform = 'file'; res.contentType = 'image';
    res.embed = { kind: 'image', src: u.toString(), aspect: 'auto' };
    return res;
  }
  if (PDF_EXT.test(u.pathname)) {
    res.platform = 'file'; res.contentType = 'doc';
    res.embed = { kind: 'iframe', src: u.toString(), aspect: 'auto', height: 720 };
    return res;
  }

  return res;
}

/** True for platforms where yt-dlp can usually fetch the actual video. */
export function isVideoPlatform(info) {
  if (!info) return false;
  return ['youtube', 'instagram', 'facebook', 'tiktok', 'x', 'vimeo', 'loom', 'threads', 'linkedin'].includes(info.platform)
    && ['reel', 'short', 'video', 'post', 'carousel', 'thread'].includes(info.contentType);
}

