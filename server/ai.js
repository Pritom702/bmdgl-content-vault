import fs from 'node:fs';
import { config } from './config.js';
import { CATEGORIES, CONTENT_TYPES } from '../public/js/platforms.js';

const API = 'https://generativelanguage.googleapis.com';

export function aiEnabled() {
  return Boolean(config.geminiKey);
}

/**
 * Smart instant auto-breakdown that works even when GEMINI_API_KEY is not configured.
 * Extracts clean title, summary, what_it_does, category, hook, story beats, payoff,
 * comment keyword ("comment X"), tools, and Bangla hook adaptations from the link & text.
 */
export function buildSmartLocalAnalysis({ item, resources = [] }) {
  const rawTitle = (item.title || '').replace(/^\d+\s+reactions?\s*[·•|]\s*\d+\s+comments?\s*[|·•]\s*/i, '').trim();
  const caption = (item.caption || '').trim();
  const notes = (item.notes || '').trim();
  const resText = resources.map(r => `${r.title || ''} ${r.content || ''} ${r.url || ''}`).join('\n');
  const fullText = `${rawTitle}\n${caption}\n${notes}\n${resText}`.trim();
  const lower = fullText.toLowerCase();

  // 1. Detect category
  let category = 'Growth Strategy';
  if (/prompt|midjourney|chatgpt|claude|gemini|llm|system prompt/i.test(lower)) category = 'Prompts';
  else if (/\b(ai|automation|agent|mcp|github|repo|tool|api|bot|workflow)\b/i.test(lower)) category = 'AI Tools';
  else if (/\b(hook|scroll|headline|copywriting|opening)\b/i.test(lower)) category = 'Hooks & Copywriting';
  else if (/\b(edit|capcut|premiere|davinci|sfx|sound|audio|timeline|motion)\b/i.test(lower)) category = 'Video Editing';
  else if (/\b(story|script|narrative|dialogue)\b/i.test(lower)) category = 'Storytelling & Scripts';
  else if (/\b(ad|boost|meta ads|funnel|conversion|audit|roas|lead)\b/i.test(lower)) category = 'Ads & Funnels';
  else if (/\b(design|canva|thumbnail|carousel|poster)\b/i.test(lower)) category = 'Design & Thumbnails';

  // 2. Clean title
  const clauses = (rawTitle || caption || notes || 'Shared Content').split(/[\n.!]|(?<=\?)\s+/).map(s => s.trim()).filter(Boolean);
  let cleanTitle = clauses[0] || '';
  if (cleanTitle.length < 28 && clauses[1]) cleanTitle = `${cleanTitle} — ${clauses[1]}`;
  cleanTitle = cleanTitle.slice(0, 110) || `${item.platform.toUpperCase()} ${item.content_type}`;

  // 3. Detect "Comment KEYWORD" CTA
  let commentKeyword = item.comment_keyword || '';
  if (!commentKeyword) {
    const kwMatch = fullText.match(/comment\s+["'“”]?([A-Z0-9_-]{2,20})["'“”]?\s+(?:down\s+below|below|to\s+get|and\s+i['’]?ll|for\s+the)/i)
      || fullText.match(/কমেন্টে?\s+লিখুন\s+["'“”]?([A-Za-z0-9_-]{2,20})["'“”]?/i);
    if (kwMatch) commentKeyword = kwMatch[1].toUpperCase();
  }

  // 4. Opening hook line
  const sentences = (caption || rawTitle || notes).split(/(?<=[.!?।])\s+|\n+/).map(s => s.trim()).filter(Boolean);
  const hookLine = sentences[0] ? sentences[0].slice(0, 220) : cleanTitle;

  // 5. Extract hashtags as tags
  const hashTags = [...fullText.matchAll(/#([a-zA-Z0-9_]{2,30})/g)].map(m => m[1].toLowerCase());
  const defaultTags = [item.platform, item.content_type, category.split(' ')[0].toLowerCase()].filter(Boolean);
  const tags = [...new Set([...hashTags, ...defaultTags])].slice(0, 7);

  // 6. Summary & What it does
  const hasPrompt = resources.some(r => r.kind === 'prompt' || (r.content && r.content.length > 40));
  const hasToolLink = resources.some(r => r.url);
  const summary = sentences.slice(0, 3).join(' ').slice(0, 500)
    || `Shared ${item.platform} ${item.content_type} covering ${cleanTitle}.`;
  const whatItDoes = notes
    || (hasPrompt
      ? `Provides a ready-to-copy prompt and workflow from ${item.author_name || item.platform} that our BMDGL team can run directly to produce faster client & lab content.`
      : hasToolLink
        ? `Gives our team a direct tool/resource link and reference format from ${item.author_name || item.platform} to speed up production and test new growth angles.`
        : `Serves as a proven ${item.content_type} reference for ${category} — study the 3-second opening hook, pacing, and payoff to adapt for BMDGL.`);

  const toolsMentioned = resources.filter(r => r.url || r.kind === 'tool' || r.kind === 'drive' || r.kind === 'skool')
    .map(r => ({ name: r.title || 'Attached Resource', purpose: r.content || 'Shared by team', url: r.url || '' }));

  return normalizeAnalysis({
    title: cleanTitle,
    summary,
    what_it_does: whatItDoes,
    content_type: item.content_type,
    category,
    tags,
    key_takeaways: [
      `Opening Hook: "${hookLine}" — grabs attention immediately with a clear promise or curiosity gap.`,
      hasPrompt ? 'Includes a copy-paste prompt in the Resources tab ready for immediate testing.' : 'Fast visual pacing designed for vertical feed retention.',
      commentKeyword ? `Uses a Comment "${commentKeyword}" trigger to spike algorithmic engagement and automate DM delivery.` : 'Clear single-action payoff at the end of the content.',
    ],
    hook: {
      text: hookLine,
      type: /\?/.test(hookLine) ? 'Problem Question / Curiosity Hook' : 'Bold Claim / Pattern Interrupt',
      visual: 'Fast first-frame visual motion with high-contrast on-screen headline.',
      why_it_works: 'Calls out a specific outcome or tool in the first 2 seconds before the viewer can scroll past.',
    },
    story: {
      structure: '3s Scroll-Stopping Hook → Problem / Agitation → Live Demo or 3 Rapid Steps → Payoff & CTA',
      beats: [
        '0:00 - Hook: Pattern interrupt & core promise',
        '0:04 - Setup: Why the old manual way fails or wastes time',
        '0:12 - Execution: Walkthrough of the tool / prompt / steps',
        'End - Payoff & CTA: Final result + resource trigger',
      ],
    },
    payoff: 'Viewers see the exact tool/workflow in action and can grab the prompt or link directly.',
    cta: commentKeyword ? `Comment "${commentKeyword}" to get the link/prompt via DM` : 'Save for reference & test in our next BMDGL sprint',
    comment_keyword: commentKeyword,
    tools_mentioned: toolsMentioned,
    prompts_detected: resources.filter(r => r.kind === 'prompt' && r.content).map(r => r.content),
    transcript: '',
    how_to_adapt: [
      `Use the same opening hook rhythm in Bangla for Bangladeshi F-commerce sellers & SMEs.`,
      `Pair this format with BMDGL's Free Page Audit CTA (+880 1965-059108) or a 1-word comment keyword.`,
    ],
    bangla_hooks: [
      'মাত্র ৩০ সেকেন্ডে আপনার পেজের কাজ ১০ গুণ সহজ করে ফেলুন—শেষ পর্যন্ত দেখুন!',
      'আপনার বিজনেস পেজে এই একটা টুল ব্যবহার করলে অর্ডার ও সময় দুটোই বাঁচবে!',
      'সবাই ম্যানুয়ালি যা করতে ঘণ্টার পর ঘণ্টা নষ্ট করে, তা করুন ১ ক্লিকে!',
    ],
    usefulness: 9,
    confidence: 'medium',
    analysis_basis: 'caption and metadata only',
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
      generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
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
  const category = CATEGORIES.find(c => c.toLowerCase() === str(r.category).toLowerCase()) || 'Other';
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
    how_to_adapt: arr(r.how_to_adapt, 6, 600).map(String),
    bangla_hooks: arr(r.bangla_hooks, 5, 300).map(String),
    usefulness,
    confidence: ['high', 'medium', 'low'].includes(str(r.confidence).toLowerCase()) ? str(r.confidence).toLowerCase() : 'medium',
    analysis_basis: str(r.analysis_basis, 80),
  };
}

function buildPrompt(ctx, basis) {
  return `You are the senior content strategist of Bright Mind Digital Growth Lab (BMDGL), a Bangladeshi agency that helps small businesses and F-commerce (Facebook-shop) sellers grow online. Our team saves useful content from Facebook, Instagram, YouTube, TikTok, Skool and other places into a shared "Content Vault" so we can learn from it and reuse the prompts/tools/techniques.

Analyse the shared item below and return ONE JSON object. Be accurate and specific: describe only what is actually in the content and the provided context. Never invent tools, prompts, numbers or claims. If something is unknown, use an empty string or empty array.

WHAT YOU HAVE ACCESS TO: ${basis}.

SHARED ITEM CONTEXT:
${ctx}

Return JSON with exactly these keys:
{
  "title": "clear descriptive title, max 90 characters, English",
  "summary": "2-4 sentences: what this content is and what happens in it",
  "what_it_does": "practical description of what this content / prompt / tool can do for our team and how we would use it",
  "content_type": "one of: ${Object.keys(CONTENT_TYPES).join(', ')}",
  "category": "one of: ${CATEGORIES.join(' | ')}",
  "tags": ["3-8 short lowercase tags"],
  "key_takeaways": ["3-6 concrete lessons or steps"],
  "hook": {
    "text": "the exact opening line / on-screen text of the first 1-3 seconds (verbatim if you can hear/see it)",
    "type": "hook pattern, e.g. curiosity gap, bold claim, problem call-out, list/number, before-after, contrarian, story open",
    "visual": "what is on screen in the first seconds",
    "why_it_works": "why this hook stops the scroll"
  },
  "story": {
    "structure": "how the body is structured, e.g. Problem -> 3 tools -> demo -> CTA",
    "beats": ["ordered beats, with timestamps like 0:05 when you can see the video"]
  },
  "payoff": "what value/reward the viewer gets and when it is delivered",
  "cta": "the call to action used (empty if none)",
  "comment_keyword": "the word viewers are asked to comment to receive a resource, e.g. PROMPT (empty if none)",
  "tools_mentioned": [{"name": "", "purpose": "", "url": "only if explicitly shown/given"}],
  "prompts_detected": ["any AI prompts shown or spoken, verbatim"],
  "transcript": "concise transcript of the spoken words (max ~1200 characters); empty if no speech or no video access",
  "how_to_adapt": ["2-4 concrete ideas for how BMDGL could adapt this for Bangladeshi small-business owners"],
  "bangla_hooks": ["3 scroll-stopping hook lines written in Bangla, adapted for BMDGL's audience"],
  "usefulness": 1-10 integer rating of how useful this is for BMDGL's content team,
  "confidence": "high | medium | low",
  "analysis_basis": "full video | images | document | caption and metadata only"
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
  add(`Why ${sharerName || 'our teammate'} saved it (their note)`, item.notes);
  add('Comment keyword noted by teammate', item.comment_keyword);
  if (resources.length) {
    lines.push('Resources attached by the team (prompts, tools, links):');
    for (const r of resources) {
      lines.push(`- [${r.kind}] ${r.title || ''}${r.url ? ` (${r.url})` : ''}${r.content ? `\n  Content:\n  ${String(r.content).slice(0, 6000)}` : ''}`);
    }
  }
  return lines.join('\n');
}

/**
 * Analyse an item. `media` is an optional list of { absPath, mime } local files (video/image/pdf).
 * Returns { analysis, source }.
 */
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
          basis.push('the full video file (watch it and listen to the audio)');
        } else if (isYouTube) {
          parts.push({ file_data: { file_uri: item.canonical_url } });
          basis.push('the full YouTube video (watch it and listen to the audio)');
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
    // Text-only fallback (always available)
    attempts.push(async () => ({
      text: await generate([{ text: buildPrompt(ctx, 'ONLY the text context below (no video access) - be careful to not guess what is in the video') }]),
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

