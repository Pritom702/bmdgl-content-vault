import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point to an isolated temp directory before importing server modules
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmdgl-vault-test-'));
process.env.DATA_DIR = tmpDir;
process.env.DISABLE_YTDLP = '1';
process.env.DISABLE_JOBS = '1';

const { analyzeUrl } = await import('../public/js/platforms.js');
const { db } = await import('../server/db.js');
const { app } = await import('../server/app.js');
const { seedIfEmpty } = await import('../server/seed.js');

let server;
let baseUrl;
let cookie = '';

before(async () => {
  seedIfEmpty();
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { db.close(); } catch { /* ignore */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

async function req(p, opts = {}) {
  const headers = { 'X-Vault': '1', ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) };
  let body = opts.body;
  if (body && typeof body === 'object') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${p}`, { ...opts, headers, body });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const data = (res.headers.get('content-type') || '').includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

test('URL analyzer recognizes Facebook, Instagram, YouTube, TikTok, Skool and Google Drive embeds', () => {
  const yt = analyzeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ');
  assert.equal(yt.platform, 'youtube');
  assert.equal(yt.contentType, 'short');
  assert.equal(yt.embed.kind, 'iframe');

  const ig = analyzeUrl('https://www.instagram.com/reel/DC9xTechDailyAI/?igsh=abc');
  assert.equal(ig.platform, 'instagram');
  assert.equal(ig.contentType, 'reel');
  assert.ok(ig.embed.src.includes('/embed/captioned'));

  const fb = analyzeUrl('https://www.facebook.com/reel/1234567890');
  assert.equal(fb.platform, 'facebook');
  assert.equal(fb.contentType, 'reel');
  assert.ok(fb.embed.src.includes('plugins/video.php'));

  const drive = analyzeUrl('https://drive.google.com/drive/folders/1r79ddBWDrvlPf9-zIF7q06LNE71rnzHM');
  assert.equal(drive.platform, 'drive');
  assert.equal(drive.contentType, 'folder');

  const skool = analyzeUrl('https://www.skool.com/ai-growth-lab/about');
  assert.equal(skool.platform, 'skool');
  assert.equal(skool.contentType, 'course');
});

test('Bootstrap, Seeded team login, Create item, Primary Resource, Libraries & Export', async () => {
  const b0 = await req('/api/bootstrap');
  assert.equal(b0.status, 200);
  assert.equal(b0.data.needsSetup, false);

  const login = await req('/api/auth/login', {
    method: 'POST',
    body: { email: 'pritom@brightmind.com', password: 'password123' },
  });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.role, 'admin');

  const team = await req('/api/team');
  assert.equal(team.status, 200);
  assert.equal(team.data.members.length, 7);

  // Create a shared Reel with prompt & tool link
  const created = await req('/api/items', {
    method: 'POST',
    body: {
      url: 'https://www.instagram.com/reel/C99TestReel/',
      title: 'YouTube Agent Skill — AI Agent Tool for YouTube Automation',
      category: 'AI Tools',
      comment_keyword: 'SKILL',
      notes: 'Great open-source AI agent skill for YouTube research.',
      tags: 'ai-agent, youtube, github',
      resources: [
        { kind: 'prompt', title: 'Agent Setup Prompt', content: 'Run the YouTube Agent Skill to fetch transcripts.', url: '' },
        { kind: 'tool', title: 'YouTube Agent Skill — GitHub Repository', content: 'AI agent skill for YouTube automation.', url: 'https://github.com/Jakeschincariol/youtube-agent-skill' },
      ],
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.item.platform, 'instagram');
  assert.equal(created.data.item.resources_list.length, 2);
  assert.equal(created.data.item.primary_resource.title, 'Agent Setup Prompt');

  const id = created.data.item.id;
  const up = await req(`/api/items/${id}/upvote`, { method: 'POST' });
  assert.equal(up.data.upvoted, true);
  assert.equal(up.data.upvotes, 1);

  const fav = await req(`/api/items/${id}/favorite`, { method: 'POST' });
  assert.equal(fav.data.favorite, true);

  const prompts = await req('/api/library/prompts');
  assert.equal(prompts.status, 200);
  assert.equal(prompts.data.prompts.length, 1);

  const tools = await req('/api/library/tools');
  assert.equal(tools.status, 200);
  assert.equal(tools.data.tools.length, 1);

  const csv = await req('/api/export.csv');
  assert.equal(csv.status, 200);
  assert.ok(csv.data.includes('YouTube Agent Skill'));
});
