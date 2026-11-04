import fs from 'node:fs';
import { config } from './config.js';
import { CATEGORIES, CONTENT_TYPES } from '../public/js/platforms.js';

const API = 'https://generativelanguage.googleapis.com';

export function aiEnabled() {
  return Boolean(config.geminiKey);
}

/**
 * Clean, accurate English Title, Category, small Description (summary), and small How-to-Use-It (what_it_does)
 * generator when GEMINI_API_KEY is not configured. Never outputs "..." or raw URL dumps.
 */
export function buildSmartLocalAnalysis({ item, resources = [], resourceMeta = [] }) {
  const rawTitle = (item.title || '')
    .replace(/^\d+[\d,.KMkm]*\s+(?:views?|reactions?|likes?)\s*[·•|-]*\s*/i, '')
    .replace(/\s*-\s*YouTube$/i, '')
    .replace(/^(?:Tool\s*\/\s*Resource\s*Link|Google\s*Drive\s*Folder\s*\/\s*Doc|Shared\s*Prompt\s*\/\s*Instructions|Shared\s*Content|Facebook\s*Reel|Instagram\s*Reel|YouTube\s*Video|YouTube\s*Short)$/i, '')
    .trim();

  const caption = (item.caption || '').trim();
  const notes = (item.notes || '').trim();
  const resText = resources.map(r => `${r.title || ''} ${r.content || ''} ${r.url || ''}`).join('\n');
  const resMetaText = resourceMeta.map(m => `${m.title || ''} ${m.caption || ''}`).join('\n');
  const fullText = `${rawTitle}\n${caption}\n${notes}\n${resText}\n${resMetaText}`.trim();

  // 1. Accurate Category Classification using weighted keyword scoring
  const scores = {
    'Motion Graphics & Documentary': 0,
    'Video Editing': 0,
    'AI Tools': 0,
    'Prompts': 0,
    'Hooks & Copywriting': 0,
    'Storytelling & Scripts': 0,
    'Ads & Funnels': 0,
    'Design & Thumbnails': 0,
    'Growth Strategy': 0,
  };
  const scoreText = `${rawTitle} ${rawTitle} ${caption} ${notes} ${resources.map(r => r.title || '').join(' ')}`.toLowerCase();

  if (/\b(documentary|motion graphics|motion-graphics|motion video|3d animation|3d motion|html canvas|after effects|camera move|cinematic motion|netflix-level|netflix-style|render|rendered to an mp4)\b/i.test(scoreText)) {
    scores['Motion Graphics & Documentary'] += 7;
  }
  if (/\b(video editing|capcut|premiere|davinci|timeline|color grading|transitions|cut)\b/i.test(scoreText)) {
    scores['Video Editing'] += 5;
  }
  if (/\b(github|repo|repository|agent skill|cli|mcp|api|bot|agent-reach|youtube-agent-skill|automation tool|open-source|ai agent)\b/i.test(scoreText)) {
    scores['AI Tools'] += 5;
  }
  if (/\b(prompt|system prompt|mega-prompt|copy me|paste this prompt|claude prompt|chatgpt prompt)\b/i.test(scoreText)) {
    scores['Prompts'] += 4;
  }
  if (/\b(hook|scroll-stopping|headline|copywriting|opening line|curiosity gap)\b/i.test(scoreText)) {
    scores['Hooks & Copywriting'] += 5;
  }
  if (/\b(storytelling|narrative|scriptwriting|story structure|dialogue)\b/i.test(scoreText)) {
    scores['Storytelling & Scripts'] += 4;
  }
  if (/\b(meta ads|facebook ads|roas|ad creative|funnel|conversion rate|lead gen|boost)\b/i.test(scoreText)) {
    scores['Ads & Funnels'] += 5;
  }
  if (/\b(thumbnail|canva|poster|carousel design|typography|color grading|figma)\b/i.test(scoreText)) {
    scores['Design & Thumbnails'] += 5;
  }
  if (/\b(growth|algorithm|reach|followers|content strategy|channel growth)\b/i.test(scoreText)) {
    scores['Growth Strategy'] += 3;
  }
  if (resources.some(r => /github\.com/i.test(r.url || ''))) scores['AI Tools'] += 3;
  if (resources.some(r => r.kind === 'prompt' || /docs\.google\.com/i.test(r.url || ''))) scores['Prompts'] += 2;

  let category = 'AI Tools';
  let bestScore = 0;
  for (const [cat, sc] of Object.entries(scores)) {
    if (sc > bestScore) {
      bestScore = sc;
      category = cat;
    }
  }

  // 2. Clean, Accurate English Title (never overwrite a real YouTube/video title with a Google Doc title)
  const captionParagraphs = caption
    .split(/\n+/)
    .map(l => l.replace(/https?:\/\/\S+/g, '').replace(/#[a-zA-Z0-9_]+/g, '').trim())
    .filter(l => l.length > 3 && !/^(link to|follow\s+@|in this video|subscribe|comment\s+)/i.test(l) && !/^[•\-*]\s*/.test(l));

  const ghMeta = resourceMeta.find(m => m.title);
  let cleanTitle = '';

  const hasDistinctVideoTitle = rawTitle && rawTitle.length >= 6 && rawTitle !== caption.slice(0, rawTitle.length);
  if (item.platform === 'youtube' && rawTitle) {
    cleanTitle = rawTitle;
  } else if (hasDistinctVideoTitle && !/^(wait until the end|watch till the end)/i.test(rawTitle)) {
    cleanTitle = rawTitle;
  } else if (ghMeta && ghMeta.title && /github/i.test(ghMeta.title)) {
    const ghClean = ghMeta.title
      .replace(/^GitHub\s*-\s*/i, '')
      .replace(/^[A-Za-z0-9_.-]+\/([A-Za-z0-9_.-]+)\s*:\s*/i, (_, repo) => `${repo.replace(/[-_]/g, ' ')} — `);
    const firstCap = (captionParagraphs[0] || '').replace(/^wait until the end!?\s*[^\w]*/i, '').trim();
    if (firstCap && firstCap.length < 38 && !ghClean.toLowerCase().includes(firstCap.toLowerCase())) {
      cleanTitle = `${firstCap} — ${ghClean}`;
    } else {
      cleanTitle = ghClean;
    }
  } else if (captionParagraphs.length) {
    const first = captionParagraphs[0].replace(/^wait until the end!?\s*[^\w]*/i, '').trim();
    cleanTitle = first || captionParagraphs[0];
  } else if (rawTitle) {
    cleanTitle = rawTitle;
  } else {
    cleanTitle = `${(item.platform || 'Shared').toUpperCase()} ${item.content_type || 'Content'}`;
  }

  cleanTitle = cleanTitle.replace(/\.\.\.+$/, '').replace(/\s+/g, ' ').trim();
  if (cleanTitle.length > 95) {
    cleanTitle = cleanTitle.slice(0, 95).replace(/\s+\S*$/, '');
  }
  if (cleanTitle) cleanTitle = cleanTitle[0].toUpperCase() + cleanTitle.slice(1);

  // 3. Detect "Comment KEYWORD" CTA
  let commentKeyword = item.comment_keyword || '';
  if (!commentKeyword) {
    const kwMatch = fullText.match(/comment\s+["'“”]?([A-Z0-9_-]{2,20})["'“”]?\s+(?:down\s+below|below|to\s+get|and\s+i['’]?ll|for\s+the)/i);
    if (kwMatch) commentKeyword = kwMatch[1].toUpperCase();
  }

  // 4. Small, Accurate Description (summary) & Small, Accurate How-to-Use-It (what_it_does) — NO "..."
  const cleanSentences = [];
  for (const para of captionParagraphs) {
    const parts = para.split(/(?<=[.!?])\s+/).map(s => s.replace(/\.\.\.+$/, '').trim()).filter(s => s.length > 12 && !/https?:\/\//i.test(s) && !/link to/i.test(s));
    for (const p of parts) {
      if (!cleanSentences.includes(p)) cleanSentences.push(p);
    }
  }

  const ensurePeriod = (s) => {
    const t = String(s || '').replace(/\.\.\.+$/g, '').trim();
    if (!t) return '';
    return /[.!?]$/.test(t) ? t : `${t}.`;
  };

  let summary = '';
  const ghCleanCaption = (ghMeta?.caption || '')
    .replace(/\.\.\.+$/g, '')
    .replace(/^Contribute to \S+ development by creating an account on GitHub\.?/i, '')
    .trim();

  if (cleanSentences.length >= 1) {
    summary = cleanSentences[0];
    if (summary.length < 110 && cleanSentences[1] && (summary.length + cleanSentences[1].length) <= 210) {
      summary = `${ ensurePeriod(summary) } ${ cleanSentences[1] }`;
    }
  } else if (ghCleanCaption && ghCleanCaption.length <= 220) {
    summary = ghCleanCaption;
  } else if (notes) {
    summary = notes.split(/(?<=[.!?])\s+/)[0];
  } else {
    summary = `Covers ${cleanTitle}${item.author_name ? ` by ${item.author_name}` : ''}`;
  }
  summary = ensurePeriod(summary);

  let whatItDoes = '';
  const primaryRes = resources[0];
  if (primaryRes) {
    if (primaryRes.kind === 'prompt' || /docs\.google\.com/i.test(primaryRes.url || '')) {
      whatItDoes = `Copy the attached prompt${primaryRes.title ? ` (${primaryRes.title})` : ''} and run it in Claude or ChatGPT with your script, voiceover, or reference assets to reproduce this workflow.`;
    } else if (/github\.com/i.test(primaryRes.url || '')) {
      whatItDoes = `Open the attached GitHub repository (${primaryRes.title || 'repo link'}) and install the tool or agent skill to automate this workflow directly.`;
    } else if (primaryRes.url) {
      whatItDoes = `Open the attached resource link (${primaryRes.title || 'tool link'}) to access the template, files, or tool shown in the video.`;
    } else {
      whatItDoes = `Copy the attached instructions below and apply them directly in your content production workflow.`;
    }
  } else if (cleanSentences.length >= 2) {
    whatItDoes = ensurePeriod(cleanSentences[1]);
  } else {
    whatItDoes = `Watch the video inside the player to study the workflow and apply it to upcoming content.`;
  }

  // 5. Extract hashtags as clean lowercase tags
  const hashTags = [...fullText.matchAll(/#([a-zA-Z0-9_]{2,30})/g)].map(m => m[1].toLowerCase());
  const defaultTags = [item.platform, item.content_type].filter(Boolean);
  const tags = [...new Set([...hashTags, ...defaultTags])].slice(0, 6);

  const toolsMentioned = resources.filter(r => r.url || r.kind === 'tool' || r.kind === 'drive' || r.kind === 'skool')
    .map(r => ({ name: r.title || 'Attached Resource', purpose: r.content || 'Shared by team', url: r.url || '' }));

  return normalizeAnalysis({
    title: cleanTitle,
    summary,
    what_it_does: whatItDoes,
    content_type: item.content_type,
    category,
    tags,
    key_takeaways: [],
    hook: {
      text: cleanTitle,
      type: 'Opening Hook',
      visual: '',
      why_it_works: '',
    },
    story: {
      structure: '',
      beats: [],
    },
    payoff: '',
    cta: commentKeyword ? `Comment "${commentKeyword}"` : '',
    comment_keyword: commentKeyword,
    tools_mentioned: toolsMentioned,
    prompts_detected: resources.filter(r => r.kind === 'prompt' && r.content).map(r => r.content),
    transcript: '',
    how_to_adapt: [],
    bangla_hooks: [],
    usefulness: 9,
    confidence: 'high',
    analysis_basis: 'caption and metadata',
  });
}

async function gfetch(url, opts = {}, ms = 120000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      ...opts,
      headers: { 'x-goog-api-key': config.geminiKey, ...(opts.headers || {}) },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

async function apiError(res) {
  let msg = `${res.status} ${res.statusText}`;
  try {
    const j = await res.json();
    if (j?.error?.message) msg = j.error.message;
  } catch { /* ignore */ }
  return new Error(`Gemini: ${msg}`);
}

export async function uploadFile(absPath, mime, displayName) {
  const data = fs.readFileSync(absPath);
  const start = await gfetch(`${API}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(data.length),
      'X-Goog-Upload-Header-Content-Type': mime,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: displayName || 'vault-media' } }),
  }, 60000);
  if (!start.ok) throw await apiError(start);
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Gemini: upload URL missing.');
  const up = await gfetch(uploadUrl, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize', 'Content-Length': String(data.length) },
    body: data,
  }, 10 * 60 * 1000);
  if (!up.ok) throw await apiError(up);
  let file = (await up.json()).file;
  const deadline = Date.now() + 5 * 60 * 1000;
  while (file && file.state === 'PROCESSING') {
    if (Date.now() > deadline) throw new Error('Gemini: file processing timed out.');
    await new Promise(r => setTimeout(r, 3000));
    const r = await gfetch(`${API}/v1beta/${file.name}`, {}, 30000);
    if (!r.ok) throw await apiError(r);
    file = await r.json();
  }
  if (!file || file.state === 'FAILED') throw new Error('Gemini: could not process the media file.');
  return file;
}

export async function deleteFile(name) {
  try { await gfetch(`${API}/v1beta/${name}`, { method: 'DELETE' }, 20000); } catch { /* ignore */ }
}

async function generate(parts) {
  const res = await gfetch(`${API}/v1beta/models/${encodeURIComponent(config.geminiModel)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.25, responseMimeType: 'application/json' },
    }),
  }, 8 * 60 * 1000);
  if (!res.ok) throw await apiError(res);
  const j = await res.json();
  const cand = j.candidates?.[0];
  if (!cand) throw new Error(`Gemini returned no answer${j.promptFeedback?.blockReason ? ` (blocked: ${j.promptFeedback.blockReason})` : ''}.`);
  const text = (cand.content?.parts || []).map(p => p.text || '').join('').trim();
  if (!text) throw new Error(`Gemini returned an empty answer (finish reason: ${cand.finishReason || 'unknown'}).`);
  return text;
}

export function parseJsonLoose(text) {
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(t); } catch { /* fallthrough */ }
  const s = t.indexOf('{'); const e = t.lastIndexOf('}');
  if (s !== -1 && e > s) return JSON.parse(t.slice(s, e + 1));
  throw new Error('AI answer was not valid JSON.');
}

const str = (v, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : v == null ? '' : String(v).trim().slice(0, max));
const arr = (v, max = 12, itemMax = 1000) => (Array.isArray(v) ? v : v ? [v] : [])
  .map(x => (typeof x === 'string' ? x.trim().slice(0, itemMax) : x)).filter(Boolean).slice(0, max);

export function normalizeAnalysis(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const hook = r.hook && typeof r.hook === 'object' ? r.hook : { text: r.hook };
  const story = r.story && typeof r.story === 'object' ? r.story : { structure: r.story };
  const category = CATEGORIES.find(c => c.toLowerCase() === str(r.category).toLowerCase()) || 'AI Tools';
  const type = Object.keys(CONTENT_TYPES).includes(str(r.content_type).toLowerCase()) ? str(r.content_type).toLowerCase() : null;
  let usefulness = parseInt(r.usefulness, 10);
  if (!Number.isFinite(usefulness)) usefulness = null; else usefulness = Math.min(10, Math.max(1, usefulness));
  const kw = str(r.comment_keyword, 60).replace(/^["'“”]+|["'“”]+$/g, '');
  return {
    title: str(r.title, 140),
    summary: str(r.summary, 2000),
    what_it_does: str(r.what_it_does, 2000),
    content_type: type,
    category,
    tags: arr(r.tags, 8, 40).map(t => String(t).toLowerCase().replace(/^#/, '').trim()).filter(Boolean),
    key_takeaways: arr(r.key_takeaways, 8, 500).map(String),
    hook: {
      text: str(hook.text, 600),
      type: str(hook.type, 80),
      visual: str(hook.visual, 600),
      why_it_works: str(hook.why_it_works, 800),
    },
    story: {
      structure: str(story.structure, 800),
      beats: arr(story.beats, 12, 300).map(String),
    },
    payoff: str(r.payoff, 1000),
    cta: str(r.cta, 500),
    comment_keyword: kw && !/^(null|none|n\/a)$/i.test(kw) ? kw : '',
    tools_mentioned: arr(r.tools_mentioned, 15).map(t => (typeof t === 'string' ? { name: t } : t))
      .filter(t => t && typeof t === 'object' && t.name)
      .map(t => ({ name: str(t.name, 100), purpose: str(t.purpose, 300), url: /^https?:\/\//i.test(str(t.url)) ? str(t.url, 500) : '' })),
    prompts_detected: arr(r.prompts_detected, 10, 4000).map(String),
    transcript: str(r.transcript, 6000),
    how_to_adapt: [],
    bangla_hooks: [],
    usefulness,
    confidence: ['high', 'medium', 'low'].includes(str(r.confidence).toLowerCase()) ? str(r.confidence).toLowerCase() : 'medium',
    analysis_basis: str(r.analysis_basis, 80),
  };
}

function buildPrompt(ctx, basis) {
  return `You are a technical content curator for Bright Mind Digital Growth Lab. Our team saves useful reels, posts, videos, prompts, and tools into a shared repository.

Analyse the shared item below and return ONE JSON object in clean, concise English only (never output Bangla and never end descriptions with "...").

WHAT YOU HAVE ACCESS TO: ${basis}.

SHARED ITEM CONTEXT:
${ctx}

Return JSON with these keys:
{
  "title": "accurate, clean English title (keep the original video title if it is already clear, max 85 chars)",
  "summary": "1-2 short, accurate sentences (under 180 chars) describing what this content/tool is about",
  "what_it_does": "1-2 short, accurate sentences (under 180 chars) explaining how to use this prompt, tool, or workflow",
  "content_type": "one of: ${Object.keys(CONTENT_TYPES).join(', ')}",
  "category": "one of: ${CATEGORIES.join(' | ')}",
  "tags": ["3-6 short lowercase English tags"],
  "comment_keyword": "the word viewers are asked to comment to receive a resource, e.g. PROMPT (empty if none)",
  "tools_mentioned": [{"name": "", "purpose": "", "url": "only if explicitly shown/given"}],
  "prompts_detected": ["any AI prompts shown or spoken, verbatim"],
  "usefulness": 1-10 integer rating,
  "confidence": "high | medium | low",
  "analysis_basis": "full video | images | document | caption and metadata"
}`;
}

function buildContext(item, resources, sharerName) {
  const lines = [];
  const add = (k, v) => { if (v) lines.push(`${k}: ${String(v).slice(0, 6000)}`); };
  add('Platform', item.platform);
  add('Detected type', item.content_type);
  add('URL', item.canonical_url || item.url);
  add('Title (from page)', item.title);
  add('Creator', item.author_name);
  add('Original caption/description', item.caption);
  add(`Team note`, item.notes);
  add('Comment keyword', item.comment_keyword);
  if (resources.length) {
    lines.push('Resources attached by the team (prompts, tools, links):');
    for (const r of resources) {
      lines.push(`- [${r.kind}] ${r.title || ''}${r.url ? ` (${r.url})` : ''}${r.content ? `\n  Content:\n  ${String(r.content).slice(0, 6000)}` : ''}`);
    }
  }
  return lines.join('\n');
}

export async function analyzeItem({ item, resources, sharerName, media = [] }) {
  if (!aiEnabled()) throw new Error('AI is not configured (set GEMINI_API_KEY).');
  const ctx = buildContext(item, resources, sharerName);
  const uploaded = [];
  try {
    const attempts = [];
    const isYouTube = item.platform === 'youtube' && item.canonical_url;
    const video = media.find(m => m.mime.startsWith('video/'));
    const others = media.filter(m => m !== video && (m.mime.startsWith('image/') || m.mime === 'application/pdf')).slice(0, 4);

    if (video || isYouTube || others.length) {
      attempts.push(async () => {
        const parts = [];
        let basis = [];
        if (video) {
          const f = await uploadFile(video.absPath, video.mime, `item-${item.id}`);
          uploaded.push(f.name);
          parts.push({ file_data: { file_uri: f.uri, mime_type: f.mimeType || video.mime } });
          basis.push('the full video file');
        } else if (isYouTube) {
          parts.push({ file_data: { file_uri: item.canonical_url } });
          basis.push('the full YouTube video');
        }
        for (const o of others) {
          const size = fs.statSync(o.absPath).size;
          if (size > 15 * 1024 * 1024) continue;
          parts.push({ inline_data: { mime_type: o.mime, data: fs.readFileSync(o.absPath).toString('base64') } });
          basis.push(o.mime === 'application/pdf' ? 'an attached PDF document' : 'an attached image/screenshot');
        }
        basis.push('the text context below');
        parts.push({ text: buildPrompt(ctx, basis.join(', ')) });
        return { text: await generate(parts), source: video ? 'video' : isYouTube ? 'youtube' : 'images' };
      });
    }
    attempts.push(async () => ({
      text: await generate([{ text: buildPrompt(ctx, 'ONLY the text context below') }]),
      source: 'metadata',
    }));

    let lastErr;
    for (const run of attempts) {
      try {
        const { text, source } = await run();
        return { analysis: normalizeAnalysis(parseJsonLoose(text)), source };
      } catch (e) {
        lastErr = e;
        console.warn(`[ai] item ${item.id}: attempt failed: ${e.message}`);
      }
    }
    throw lastErr;
  } finally {
    for (const n of uploaded) deleteFile(n);
  }
}
