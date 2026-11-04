import fs from 'node:fs';
import { config } from './config.js';
import { db, ensureCategory, getAllCategories } from './db.js';
import { CATEGORIES, CONTENT_TYPES } from '../public/js/platforms.js';

const API = 'https://generativelanguage.googleapis.com';

export function aiEnabled() {
  return Boolean(config.geminiKey);
}

export function getLearnedPreferenceContext() {
  try {
    const logs = db.prepare('SELECT action, detail, created_at FROM preference_logs ORDER BY id DESC LIMIT 25').all();
    const favs = db.prepare(`SELECT i.title, i.category, i.platform FROM favorites f JOIN items i ON i.id = f.item_id ORDER BY f.rowid DESC LIMIT 10`).all();
    const lines = [
      '- Always write in clear, concise English only (never output Bangla).',
      '- Never truncate descriptions with "..."; every sentence must be complete and self-contained.',
      '- Distinguish code-driven 3D animations, HTML canvas visuals, After Effects, and documentary motion graphics as "Motion Graphics & Documentary" rather than generic "Video Editing".',
      '- Keep descriptions (summary) to 1-2 crisp sentences explaining what the content/tool is, and "what_it_does" to 1-2 actionable sentences on how the team should use it.',
    ];
    if (favs.length) {
      lines.push(`- Star-marked favorite content by the team: ${favs.map(f => `"${f.title}" [${f.category}]`).join('; ')}`);
    }
    for (const l of logs) {
      lines.push(`- User preference event (${l.action}): ${l.detail}`);
    }
    return lines.join('\n');
  } catch {
    return '- Write concise, accurate English titles and 1-2 sentence descriptions without "...".';
  }
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
  const sep = url.includes('?') ? '&' : '?';
  const fullUrl = url.includes('key=') ? url : `${url}${sep}key=${encodeURIComponent(config.geminiKey)}`;
  try {
    return await fetch(fullUrl, {
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
  const models = [...new Set([config.geminiModel, 'gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash-lite'])];
  let lastError;
  for (const model of models) {
    const res = await gfetch(`${API}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.25, responseMimeType: 'application/json' },
      }),
    }, 90000);
    if (!res.ok) {
      lastError = await apiError(res);
      if ([429, 500, 502, 503, 504].includes(res.status)) continue;
      throw lastError;
    }
    const j = await res.json();
    const cand = j.candidates?.[0];
    if (!cand) {
      lastError = new Error(`Gemini returned no answer${j.promptFeedback?.blockReason ? ` (blocked: ${j.promptFeedback.blockReason})` : ''}.`);
      continue;
    }
    const text = (cand.content?.parts || []).map(p => p.text || '').join('').trim();
    if (!text) {
      lastError = new Error(`Gemini returned an empty answer (finish reason: ${cand.finishReason || 'unknown'}).`);
      continue;
    }
    return text;
  }
  throw lastError || new Error('Gemini generation failed.');
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
  const allCats = getAllCategories(CATEGORIES);
  const rawCat = str(r.category, 42).replace(/\.\.\.+$/g, '').trim();
  let category = allCats.find(c => c.toLowerCase() === rawCat.toLowerCase());
  if (!category && rawCat && rawCat.length >= 3 && !/^(null|none|n\/a|unknown)$/i.test(rawCat)) {
    // Format new category in clean Title Case and register it automatically
    const titleCased = rawCat.split(/\s+/).map(w => (/^(ai|3d|ui|ux|seo|cta|api|cli|vfx|sfx)$/i.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ');
    category = ensureCategory(titleCased, 'agent');
  }
  if (!category) category = 'AI Tools';

  const type = Object.keys(CONTENT_TYPES).includes(str(r.content_type).toLowerCase()) ? str(r.content_type).toLowerCase() : null;
  let usefulness = parseInt(r.usefulness, 10);
  if (!Number.isFinite(usefulness)) usefulness = null; else usefulness = Math.min(10, Math.max(1, usefulness));
  const kw = str(r.comment_keyword, 60).replace(/^["'“”]+|["'“”]+$/g, '');
  const cleanSentence = (s, max) => {
    const t = str(s, max).replace(/\.\.\.+$/g, '').trim();
    if (!t) return '';
    return /[.!?]$/.test(t) ? t : `${t}.`;
  };
  return {
    title: str(r.title, 140).replace(/\.\.\.+$/g, '').trim(),
    summary: cleanSentence(r.summary, 2000),
    what_it_does: cleanSentence(r.what_it_does, 2000),
    content_type: type,
    category,
    created_new_category: Boolean(r.created_new_category),
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
  const existingCats = getAllCategories(CATEGORIES).filter(c => c !== 'Other');
  const prefs = getLearnedPreferenceContext();
  return `You are the Autonomous Vault AI Agent for Bright Mind Digital Growth Lab (led by Pritom).
Your job is to:
1. Identify the exact category for this shared content. Existing categories are: [${existingCats.join(' | ')}]. If one of these fits accurately, use it. If this content belongs to a specific domain that does NOT exist in that list yet (for example: "3D & WebGL Animation", "Voiceover & Sound Design", "Vibe Coding & AI Dev", "YouTube Channel Strategy", etc.), CREATE a new, concise 2-4 word Title Case category name and set "created_new_category": true!
2. Write an accurate, clean English "title" (preserve the original creator/YouTube title if it is already clear and accurate; for reels/tools with vague captions, craft a specific English title under 85 chars).
3. Write a concise, accurate 1-2 sentence "summary" (Description) and a 1-2 sentence "what_it_does" (How to use it). Never use "..." truncation and never output Bangla.

LEARNED USER & TEAM PREFERENCES:
${prefs}

WHAT YOU HAVE ACCESS TO: ${basis}.

SHARED ITEM CONTEXT:
${ctx}

Return JSON with these exact keys:
{
  "title": "accurate, clean English title (max 85 chars)",
  "summary": "1-2 short, complete sentences describing what this video/tool/prompt is about (no '...')",
  "what_it_does": "1-2 short, complete sentences explaining how the team should use this prompt, tool, or workflow (no '...')",
  "content_type": "one of: ${Object.keys(CONTENT_TYPES).join(', ')}",
  "category": "existing category name OR a newly created 2-4 word Title Case category name if no existing category fits accurately",
  "created_new_category": true or false,
  "tags": ["4-6 short lowercase English search keywords"],
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

export async function analyzeItem({ item, resources = [], resourceMeta = [], sharerName, media = [] }) {
  if (!aiEnabled()) {
    return { analysis: buildSmartLocalAnalysis({ item, resources, resourceMeta }), source: 'smart-auto' };
  }
  const extraMeta = resourceMeta.map(m => `${m.title || ''} ${m.caption || ''}`).filter(Boolean).join('\n');
  const ctx = `${buildContext(item, resources, sharerName)}${extraMeta ? `\nFetched Resource Metadata:\n${extraMeta}` : ''}`;
  const uploaded = [];
  try {
    const attempts = [];
    const others = media.filter(m => m.mime.startsWith('image/') || m.mime === 'application/pdf').slice(0, 3);

    // 1. Fast Gemini 2.5 Flash analysis with rich metadata, extracted Google Doc/GitHub text & learned preferences
    attempts.push(async () => {
      const parts = [];
      for (const o of others) {
        try {
          const size = fs.statSync(o.absPath).size;
          if (size <= 8 * 1024 * 1024) {
            parts.push({ inline_data: { mime_type: o.mime, data: fs.readFileSync(o.absPath).toString('base64') } });
          }
        } catch { /* ignore */ }
      }
      parts.push({ text: buildPrompt(ctx, 'the full title, creator, caption, attached prompts/tools, and learned team preferences') });
      return { text: await generate(parts), source: 'gemini-agent' };
    });

    for (const run of attempts) {
      try {
        const { text, source } = await run();
        return { analysis: normalizeAnalysis(parseJsonLoose(text)), source };
      } catch (e) {
        console.warn(`[ai] item ${item.id}: Gemini attempt failed (${e.message}), using smart fallback`);
      }
    }
    return { analysis: buildSmartLocalAnalysis({ item, resources, resourceMeta }), source: 'smart-auto' };
  } finally {
    for (const n of uploaded) deleteFile(n);
  }
}

/**
 * Generates a proactive AI Agent Briefing for Pritom:
 * 1. Learns from user preferences, category edits, star-marked items, and shared content.
 * 2. Tells Pritom from time to time what we should upgrade next in the repository.
 */
export async function generateAgentInsightsForPritom() {
  const items = db.prepare("SELECT id, title, category, platform, summary, what_it_does, created_at FROM items WHERE status != 'archived' ORDER BY id DESC LIMIT 30").all();
  const resources = db.prepare("SELECT kind, title, url FROM resources ORDER BY id DESC LIMIT 30").all();
  const allCats = getAllCategories(CATEGORIES).filter(c => c !== 'Other');
  const prefs = getLearnedPreferenceContext();

  const defaultBriefing = {
    summary: `Pritom, your Vault AI Agent (${config.geminiModel}) is actively monitoring ${items.length} shared items across ${allCats.length} categories, learning your categorization & description preferences, and creating new categories automatically whenever novel content arrives.`,
    learned_preferences: [
      'Categorize code-rendered 3D animations, HTML canvas visuals, and documentary motion graphics under "Motion Graphics & Documentary" instead of generic "Video Editing".',
      'Write concise, accurate 1-2 sentence English descriptions and "How to use it" guides with zero "..." truncation and zero Bangla.',
      'Automatically extract full prompt text from Google Docs and repository descriptions from GitHub links into the unified Prompts, Tools & Links library.',
      'Prioritize high-leverage Claude workflows, AI agent skills, and reproducible documentary/content automation pipelines.',
    ],
    recommendations: [
      {
        title: 'Add a Dedicated "Voiceover & Sound Design" Category with Reference Assets',
        category: 'Content Expansion',
        why: 'Your Motion Graphics & Documentary workflow relies on timestamped voiceovers and pacing, which currently has no dedicated audio/SFX reference items.',
        action: 'Share 2-3 top ElevenLabs / SFX pacing reels or prompt templates — the Agent will automatically create the "Voiceover & Sound Design" category.',
      },
      {
        title: 'Auto-Tag Reusable Claude System Prompts by Output Format (Canvas MP4 vs. CLI Skill)',
        category: 'Repository Organization',
        why: 'Your repository now mixes browser/HTML-canvas code prompts with terminal CLI agent skills (Agent Reach, YouTube Agent Skill).',
        action: 'Keep dropping Google Doc and GitHub links in the 2nd input box — the Agent now tags them by execution environment for instant search.',
      },
      {
        title: 'Build a "Tested & Used in Production" Showcase Filter for Top-Performing Workflows',
        category: 'Workflow Upgrade',
        why: 'As teammates star-mark their favorite items, tracking which prompts actually produced published videos helps the team double down on winning formats.',
        action: 'Mark items as "Used in our content" inside the video modal whenever a prompt or tool is used in a live production video.',
      },
    ],
  };

  if (!aiEnabled()) {
    db.prepare('INSERT INTO agent_insights(summary, learned_preferences_json, recommendations_json) VALUES (?, ?, ?)')
      .run(defaultBriefing.summary, JSON.stringify(defaultBriefing.learned_preferences), JSON.stringify(defaultBriefing.recommendations));
    return getLatestAgentInsights();
  }

  const prompt = `You are Pritom's Autonomous Vault AI Agent for Bright Mind Digital Growth Lab (BMDGL Content Vault).
Your role is to:
1. Continuously learn Pritom's and the team's content preferences, categorization standards, and description style.
2. Proactively tell Pritom from time to time what we should upgrade, organize, or add next in the repository to make the team 10x faster.

CURRENT REPOSITORY SNAPSHOT:
- Active Categories (${allCats.length}): ${allCats.join(', ')}
- Current Items (${items.length}):
${items.map(i => `  * [${i.category}] (${i.platform}) "${i.title}" — ${i.summary}`).join('\n')}
- Attached Prompts, Tools & Links (${resources.length}):
${resources.map(r => `  * [${r.kind}] ${r.title} (${r.url || 'text prompt'})`).join('\n')}

LEARNED PREFERENCES & USER ACTIVITY LOGS:
${prefs}

Return ONE JSON object in clean English with these exact keys:
{
  "summary": "A direct, insightful 2-sentence status update addressed to Pritom summarizing what the Agent has learned about his preferences and the current focus of the repository.",
  "learned_preferences": [
    "4 specific, concrete bullet strings describing the exact preferences and categorization/formatting rules you have learned from Pritom and the team"
  ],
  "recommendations": [
    {
      "title": "Specific, high-impact upgrade recommendation for the repository",
      "category": "e.g. New Category Opportunity | Workflow Upgrade | Repository Feature | Content Gap",
      "why": "1 concise sentence explaining why this matters based on what is currently in the Vault",
      "action": "1 concise, actionable next step for Pritom or the team"
    }
  ]
} (Provide 3 to 4 recommendations).`;

  try {
    const text = await generate([{ text: prompt }]);
    const parsed = parseJsonLoose(text);
    const summary = str(parsed.summary, 600) || defaultBriefing.summary;
    const learned = arr(parsed.learned_preferences, 6, 300).length ? arr(parsed.learned_preferences, 6, 300) : defaultBriefing.learned_preferences;
    const recs = Array.isArray(parsed.recommendations) && parsed.recommendations.length
      ? parsed.recommendations.slice(0, 4).map(r => ({
          title: str(r.title, 140),
          category: str(r.category, 60) || 'Repository Upgrade',
          why: str(r.why, 300),
          action: str(r.action, 300),
        }))
      : defaultBriefing.recommendations;

    db.prepare('INSERT INTO agent_insights(summary, learned_preferences_json, recommendations_json) VALUES (?, ?, ?)')
      .run(summary, JSON.stringify(learned), JSON.stringify(recs));
  } catch (e) {
    console.warn('[ai] generateAgentInsightsForPritom fallback:', e.message);
    db.prepare('INSERT INTO agent_insights(summary, learned_preferences_json, recommendations_json) VALUES (?, ?, ?)')
      .run(defaultBriefing.summary, JSON.stringify(defaultBriefing.learned_preferences), JSON.stringify(defaultBriefing.recommendations));
  }
  return getLatestAgentInsights();
}

export function getLatestAgentInsights() {
  const row = db.prepare('SELECT * FROM agent_insights ORDER BY id DESC LIMIT 1').get();
  if (!row) return null;
  let learned = [];
  let recs = [];
  try { learned = JSON.parse(row.learned_preferences_json || '[]'); } catch { /* ignore */ }
  try { recs = JSON.parse(row.recommendations_json || '[]'); } catch { /* ignore */ }
  return {
    id: row.id,
    summary: row.summary,
    learned_preferences: learned,
    recommendations: recs,
    created_at: row.created_at,
    model: config.geminiModel,
    ai_enabled: aiEnabled(),
  };
}
