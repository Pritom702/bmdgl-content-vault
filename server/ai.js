import fs from 'node:fs';
import { config } from './config.js';
import { CATEGORIES, CONTENT_TYPES } from '../public/js/platforms.js';

const API = 'https://generativelanguage.googleapis.com';

export function aiEnabled() {
  return Boolean(config.geminiKey);
}

/**
 * Clean, accurate English Title & Description generator when GEMINI_API_KEY is not configured.
 * Combines the Reel/post caption, page title, and any attached tool/GitHub/prompt metadata
 * into a clear, human-readable English title and description.
 */
export function buildSmartLocalAnalysis({ item, resources = [], resourceMeta = [] }) {
  const rawTitle = (item.title || '')
    .replace(/^\d+[\d,.KMkm]*\s+(?:views?|reactions?|likes?)\s*[·•|-]*\s*/i, '')
    .replace(/^(?:Tool\s*\/\s*Resource\s*Link|Shared\s*Prompt\s*\/\s*Instructions|Shared\s*Content|Facebook\s*Reel|Instagram\s*Reel)$/i, '')
    .trim();

  const caption = (item.caption || '').trim();
  const notes = (item.notes || '').trim();
  const resText = resources.map(r => `${r.title || ''} ${r.content || ''} ${r.url || ''}`).join('\n');
  const resMetaText = resourceMeta.map(m => `${m.title || ''} ${m.caption || ''}`).join('\n');
  const fullText = `${rawTitle}\n${caption}\n${notes}\n${resText}\n${resMetaText}`.trim();
  const lower = fullText.toLowerCase();

  // 1. Detect category
  let category = 'AI Tools';
  if (/prompt|midjourney|system prompt|mega-prompt/i.test(lower) && !/github\.com/i.test(lower)) category = 'Prompts';
  else if (/\b(ai|automation|agent|skill|mcp|github|repo|tool|api|bot|workflow|claude|chatgpt|gemini|llm)\b/i.test(lower)) category = 'AI Tools';
  else if (/\b(hook|scroll|headline|copywriting|opening)\b/i.test(lower)) category = 'Hooks & Copywriting';
  else if (/\b(edit|capcut|premiere|davinci|sfx|sound|audio|timeline|motion)\b/i.test(lower)) category = 'Video Editing';
  else if (/\b(story|script|narrative|dialogue)\b/i.test(lower)) category = 'Storytelling & Scripts';
  else if (/\b(ad|boost|meta ads|funnel|conversion|audit|roas|lead)\b/i.test(lower)) category = 'Ads & Funnels';
  else if (/\b(design|canva|thumbnail|carousel|poster)\b/i.test(lower)) category = 'Design & Thumbnails';
  else category = 'Growth Strategy';

  // 2. Build a clean, accurate English Title
  const captionLines = caption
    .split(/\n+/)
    .map(l => l.replace(/#[a-zA-Z0-9_]+/g, '').trim())
    .filter(l => l.length > 2 && !/^follow\s+@/i.test(l));

  const ghMeta = resourceMeta.find(m => m.title);
  let cleanTitle = '';

  if (ghMeta && ghMeta.title) {
    // e.g. "GitHub - Panniantong/agent-reach: Give your AI agent eyes to see the entire internet"
    const ghClean = ghMeta.title
      .replace(/^GitHub\s*-\s*/i, '')
      .replace(/^[A-Za-z0-9_.-]+\/([A-Za-z0-9_.-]+)\s*:\s*/i, (_, repo) => `${repo.replace(/[-_]/g, ' ')} — `);
    if (captionLines[0] && captionLines[0].length < 40 && !ghClean.toLowerCase().includes(captionLines[0].toLowerCase())) {
      cleanTitle = `${captionLines[0]} — ${ghClean}`;
    } else {
      cleanTitle = ghClean;
    }
  } else if (captionLines.length) {
    const first = captionLines[0].replace(/^wait until the end!?\s*[^\w]*/i, '').trim();
    cleanTitle = first || captionLines[0];
    if (cleanTitle.length < 28 && captionLines[1]) {
      cleanTitle = `${cleanTitle} — ${captionLines[1]}`;
    }
  } else if (rawTitle) {
    cleanTitle = rawTitle;
  } else if (resources[0]?.url) {
    try {
      const u = new URL(resources[0].url);
      const slug = u.pathname.split('/').filter(Boolean).pop() || u.hostname;
      cleanTitle = `${slug.replace(/[-_]/g, ' ')} (${u.hostname.replace(/^www\./, '')})`;
    } catch {
      cleanTitle = resources[0].title || 'Shared Tool & Resource';
    }
  } else {
    cleanTitle = `${(item.platform || 'Shared').toUpperCase()} ${item.content_type || 'Content'}`;
  }

  // Capitalize first letter nicely and cap length
  cleanTitle = cleanTitle.replace(/\s+/g, ' ').trim().slice(0, 110);
  if (cleanTitle) cleanTitle = cleanTitle[0].toUpperCase() + cleanTitle.slice(1);

  // 3. Detect "Comment KEYWORD" CTA
  let commentKeyword = item.comment_keyword || '';
  if (!commentKeyword) {
    const kwMatch = fullText.match(/comment\s+["'“”]?([A-Z0-9_-]{2,20})["'“”]?\s+(?:down\s+below|below|to\s+get|and\s+i['’]?ll|for\s+the)/i);
    if (kwMatch) commentKeyword = kwMatch[1].toUpperCase();
  }

  // 4. Build a clean, concise English Description (Summary & What it does)
  const cleanCaptionBody = captionLines.join(' ').replace(/\s+/g, ' ').trim();
  const ghDesc = ghMeta?.caption || '';

  let summary = '';
  if (cleanCaptionBody && ghDesc && !cleanCaptionBody.includes(ghDesc.slice(0, 25))) {
    summary = `${cleanCaptionBody} — ${ghDesc}`.slice(0, 550);
  } else if (ghDesc) {
    summary = ghDesc.slice(0, 500);
  } else if (cleanCaptionBody) {
    summary = cleanCaptionBody.slice(0, 500);
  } else if (notes) {
    summary = notes.slice(0, 500);
  } else {
    summary = `Shared ${item.platform} ${item.content_type}: ${cleanTitle}.`;
  }

  let whatItDoes = '';
  if (ghDesc) {
    whatItDoes = ghDesc.slice(0, 450);
  } else if (notes && notes !== summary) {
    whatItDoes = notes.slice(0, 450);
  } else if (resources.some(r => r.url)) {
    const r = resources.find(x => x.url);
    whatItDoes = `Includes direct link to ${r.title && r.title !== 'Tool / Resource Link' ? r.title : r.url} so the team can open, test, and apply it directly in your workflow.`;
  } else if (resources.some(r => r.content)) {
    whatItDoes = `Includes a ready-to-use prompt/resource attached below that the team can copy and run directly.`;
  } else {
    whatItDoes = summary;
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
      text: captionLines[0] || cleanTitle,
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

/** Upload a local file to the Gemini Files API and wait until it is ACTIVE. */
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

/** Make sure whatever the model returned has the exact shape the UI expects. */
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

Analyse the shared item below and return ONE JSON object in clean, concise English only (never output Bangla). Be accurate and specific: describe clearly what the reel/post/tool is about and what it does.

WHAT YOU HAVE ACCESS TO: ${basis}.

SHARED ITEM CONTEXT:
${ctx}

Return JSON with these keys:
{
  "title": "clear, simple, descriptive title in English (max 85 characters)",
  "summary": "2-3 clear sentences in English explaining what this content/reel/tool is about and what it does",
  "what_it_does": "1-2 sentences in English explaining how to use this tool, prompt, or workflow",
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
