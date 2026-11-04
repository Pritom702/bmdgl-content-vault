import {
  PLATFORMS, CONTENT_TYPES, CATEGORIES, STATUSES, RESOURCE_STATUSES, RESOURCE_KINDS,
  analyzeUrl, extractUrl,
} from './platforms.js';

const TEAM_DEMO_USERS = [
  { name: 'Pritom',   email: 'pritom@brightmind.com',   password: 'password123', role: 'Admin',  color: '#2563EB' },
  { name: 'Sharafat', email: 'sharafat@brightmind.com', password: 'password123', role: 'Admin',  color: '#7C3AED' },
  { name: 'Minhaj',   email: 'minhaj@brightmind.com',   password: 'password123', role: 'Member', color: '#DB2777' },
  { name: 'Saiful',   email: 'saiful@brightmind.com',   password: 'password123', role: 'Member', color: '#EA580C' },
  { name: 'Rafi',     email: 'rafi@brightmind.com',     password: 'password123', role: 'Member', color: '#16A34A' },
  { name: 'Tanvir',   email: 'tanvir@brightmind.com',   password: 'password123', role: 'Member', color: '#0891B2' },
  { name: 'Akib',     email: 'akib@brightmind.com',     password: 'password123', role: 'Member', color: '#CA8A04' },
];

const state = {
  boot: null,
  user: null,
  view: 'vault', // 'vault' | 'prompts' | 'hooks' | 'tools' | 'team'
  layout: localStorage.getItem('vault_layout') || 'grid',
  theme: localStorage.getItem('vault_theme') || 'dark',
  sidebarOpen: false,
  filters: {
    q: '',
    platform: '',
    category: '',
    type: '',
    status: '',
    resource: '',
    tag: '',
    fav: '',
    pending: '',
    collection: '',
    sharer: '',
    sort: 'newest',
  },
  stats: null,
  collections: [],
  tags: [],
  items: [],
  total: 0,
  loading: false,
  activeItem: null,
  activeTab: 'breakdown', // 'breakdown' | 'resources' | 'adapt' | 'discussion' | 'edit'
  stageMode: 'auto', // 'auto' | 'offline' | 'embed'
  prompts: [],
  hooks: [],
  tools: [],
  team: { members: [], inviteCode: null },
  pollTimer: null,
};

document.documentElement.setAttribute('data-theme', state.theme);

// ---------- Utilities ----------
function esc(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function initials(name) {
  if (!name) return '?';
  return String(name).trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');
}

function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z');
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

function formatBytes(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function toast(msg, isErr = false) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast${isErr ? ' err' : ''}`;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

async function copyText(txt, label = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(txt || '');
    toast(`✓ ${label}`);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = txt || '';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast(`✓ ${label}`);
  }
}

async function api(path, opts = {}) {
  const headers = { 'X-Vault': '1', ...(opts.headers || {}) };
  let body = opts.body;
  if (body && !(body instanceof FormData) && typeof body === 'object') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(path, { ...opts, headers, body, credentials: 'same-origin' });
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    throw new Error((data && data.error) ? data.error : `Request failed (${res.status})`);
  }
  return data;
}

/**
 * Smart parser for the 2nd input box ("Prompt / Tool Link / Comment Keyword").
 * Automatically detects whether the teammate pasted a URL, a "Comment X" keyword, or a prompt/note.
 */
function parseSmartResourceInput(raw) {
  const txt = (raw || '').trim();
  if (!txt) return { resources: [], comment_keyword: '', notes: '' };
  const url = extractUrl(txt);
  const rest = url ? txt.replace(url, '').trim() : txt;

  // Check if they just typed a single keyword like "PROMPT" or "comment SOUND"
  const kwOnly = txt.match(/^(?:comment\s+)?["']?([A-Za-z0-9_-]{2,18})["']?$/i);
  if (kwOnly && !url) {
    return { resources: [], comment_keyword: kwOnly[1].toUpperCase(), notes: '' };
  }

  let kind = 'prompt';
  let title = 'Shared Prompt / Instructions';
  if (url) {
    if (/drive\.google\.com|docs\.google\.com/i.test(url)) { kind = 'drive'; title = rest || 'Google Drive Folder / Doc'; }
    else if (/skool\.com/i.test(url)) { kind = 'skool'; title = rest || 'Skool Community Resource'; }
    else { kind = 'tool'; title = rest.slice(0, 80) || 'Tool / Resource Link'; }
  }
  return {
    resources: [{ kind, title, content: rest, url: url || '' }],
    comment_keyword: '',
    notes: rest,
  };
}

// ---------- Boot & Data Loading ----------
async function init() {
  try {
    state.boot = await api('/api/bootstrap', { method: 'GET' });
    state.user = state.boot.user;
    if (!state.user) {
      renderAuth();
      return;
    }
    await loadAllData();
    handleHashRoute();
    window.addEventListener('hashchange', handleHashRoute);
    setupGlobalShortcuts();
  } catch (e) {
    toast(e.message, true);
  }
}

async function loadAllData() {
  const [stats, colls, tags] = await Promise.all([
    api('/api/stats'),
    api('/api/collections'),
    api('/api/tags'),
  ]);
  state.stats = stats;
  state.collections = colls.collections || [];
  state.tags = tags.tags || [];
  await loadItems();
  scheduleBackgroundPoll();
}

async function loadItems() {
  state.loading = true;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(state.filters)) {
    if (v !== '' && v != null) params.set(k, v);
  }
  const res = await api(`/api/items?${params.toString()}`);
  state.items = res.items || [];
  state.total = res.total || 0;
  state.loading = false;
  renderApp();
}

function scheduleBackgroundPoll() {
  clearTimeout(state.pollTimer);
  const busy = state.items.some(i => i.ai_status === 'pending' || i.ai_status === 'processing' || i.archive_status === 'processing')
    || (state.activeItem && (state.activeItem.ai_status === 'pending' || state.activeItem.ai_status === 'processing' || state.activeItem.archive_status === 'processing'));
  if (busy) {
    state.pollTimer = setTimeout(async () => {
      try {
        state.stats = await api('/api/stats');
        await loadItems();
        if (state.activeItem) {
          const d = await api(`/api/items/${state.activeItem.id}`);
          state.activeItem = d.item;
          renderModal();
        }
        scheduleBackgroundPoll();
      } catch { /* ignore */ }
    }, 2800);
  }
}

// ---------- Auth Screen (Confidential Portal + 1-Tap Team Login + Forgot Password) ----------
let authMode = 'login'; // 'login' | 'forgot' | 'register'
function renderAuth() {
  const needsSetup = state.boot?.needsSetup;
  if (needsSetup) authMode = 'register';
  const app = document.getElementById('app');

  app.innerHTML = `
    <div class="auth-minimal">
      <div class="auth-card">
        <div class="auth-header">
          <img src="/logo.png" alt="Bright Mind">
          <div>
            <h2>BMDGL Content Vault</h2>
            <div class="sub">Internal Team Portal · Persistent Login Enabled</div>
          </div>
        </div>

        ${authMode === 'login' ? `
          <div class="team-quick-box">
            <div class="team-quick-title">
              <span>⚡ 1-Click Team Access (Tap your name)</span>
              <span style="font-family:var(--font-mono);font-size:10.5px">pw: password123</span>
            </div>
            <div class="team-chips">
              ${TEAM_DEMO_USERS.map(u => `
                <button type="button" class="team-chip-btn" data-quick-login="${esc(u.email)}">
                  <span class="team-chip-dot" style="background:${u.color}">${esc(u.name[0])}</span>
                  <div style="min-width:0">
                    <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.name)}</div>
                    <div style="font-size:10px;color:var(--mute);font-weight:600">${esc(u.role)}</div>
                  </div>
                </button>
              `).join('')}
            </div>
          </div>

          <form id="auth-form">
            <div class="field">
              <label>Email Address</label>
              <input name="email" id="auth-email" type="email" required placeholder="name@brightmind.com">
            </div>
            <div class="field">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <label>Password</label>
                <a href="#" id="link-forgot-pw" style="font-size:12px;font-weight:700">Forgot password?</a>
              </div>
              <input name="password" id="auth-pass" type="password" required placeholder="••••••••">
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%;padding:11px;margin-top:4px">
              Sign In (Keep Me Logged In) →
            </button>
          </form>
        ` : authMode === 'forgot' ? `
          <div style="margin-bottom:14px;font-size:13px;color:var(--ink-2)">
            Enter your team email and choose a new password. You will be signed in immediately.
          </div>
          <form id="forgot-form">
            <div class="field">
              <label>Your Team Email</label>
              <input name="email" type="email" required placeholder="e.g. minhaj@brightmind.com">
            </div>
            <div class="field">
              <label>New Password</label>
              <input name="newPassword" type="password" required minlength="6" placeholder="Enter new password (min 6 chars)">
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%;padding:11px;margin-top:4px">
              Reset Password &amp; Sign In →
            </button>
            <button type="button" class="btn" id="btn-back-login" style="width:100%;margin-top:8px">
              ← Back to Sign In
            </button>
          </form>
        ` : `
          <form id="auth-form">
            <div class="field">
              <label>Your Name</label>
              <input name="name" required placeholder="Full Name">
            </div>
            <div class="field">
              <label>Email Address</label>
              <input name="email" type="email" required placeholder="name@brightmind.com">
            </div>
            <div class="field">
              <label>Password</label>
              <input name="password" type="password" required minlength="8" placeholder="At least 8 characters">
            </div>
            ${!needsSetup ? `
              <div class="field">
                <label>Team Invite Code</label>
                <input name="inviteCode" required placeholder="Ask admin for invite code">
              </div>
            ` : ''}
            <button type="submit" class="btn btn-primary" style="width:100%;padding:11px;margin-top:4px">
              Create Account →
            </button>
          </form>
        `}
      </div>
    </div>
  `;

  // 1-Click Team Login buttons
  app.querySelectorAll('[data-quick-login]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const email = btn.dataset.quickLogin;
      try {
        const res = await api('/api/auth/login', { method: 'POST', body: { email, password: 'password123' } });
        state.user = res.user;
        toast(`Signed in as ${state.user.name}`);
        await loadAllData();
        handleHashRoute();
      } catch {
        // If user changed their password previously, prefill email and focus password
        const em = document.getElementById('auth-email');
        if (em) em.value = email;
        document.getElementById('auth-pass')?.focus();
        toast('Custom password set — enter your password or click Forgot password.');
      }
    });
  });

  app.querySelector('#link-forgot-pw')?.addEventListener('click', (e) => {
    e.preventDefault();
    authMode = 'forgot';
    renderAuth();
  });

  app.querySelector('#btn-back-login')?.addEventListener('click', () => {
    authMode = 'login';
    renderAuth();
  });

  app.querySelector('#forgot-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const res = await api('/api/auth/forgot-password', { method: 'POST', body: Object.fromEntries(fd.entries()) });
      state.user = res.user;
      toast(`✓ Password updated! Welcome back, ${state.user.name}.`);
      await loadAllData();
      handleHashRoute();
    } catch (err) {
      toast(err.message, true);
    }
  });

  app.querySelector('#auth-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    try {
      const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const res = await api(endpoint, { method: 'POST', body: payload });
      state.user = res.user;
      state.boot.needsSetup = false;
      toast(`Welcome, ${state.user.name}!`);
      await loadAllData();
      handleHashRoute();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---------- Main Application Render (Full-Width Top Navbar Layout) ----------
function renderApp() {
  if (!state.user) return renderAuth();
  const app = document.getElementById('app');
  const s = state.stats || { total: 0, favorites: 0, pending: 0, testing: 0, used: 0, prompts: 0 };
  const f = state.filters;

  app.innerHTML = `
    <div class="app-layout">
      <header class="top-header">
        <div class="top-header-inner">
          <div class="brand-link" data-nav="all">
            <img src="/logo.png" alt="BMDGL">
            <div>
              <span class="b-title">BMDGL Vault</span>
              <span class="b-sub">Digital Growth Lab</span>
            </div>
          </div>

          <nav class="top-nav-tabs">
            <button type="button" class="top-nav-btn ${state.view === 'vault' ? 'active' : ''}" data-nav="all">
              🎬 Feed <span class="pill-count">${s.total}</span>
            </button>
            <button type="button" class="top-nav-btn ${state.view === 'prompts' ? 'active' : ''}" data-view="prompts">
              ✨ Prompts <span class="pill-count">${s.prompts}</span>
            </button>
            <button type="button" class="top-nav-btn ${state.view === 'hooks' ? 'active' : ''}" data-view="hooks">
              🎯 Hooks &amp; Payoffs
            </button>
            <button type="button" class="top-nav-btn ${state.view === 'tools' ? 'active' : ''}" data-view="tools">
              🧰 Tools &amp; Links
            </button>
            <button type="button" class="top-nav-btn ${state.view === 'team' ? 'active' : ''}" data-view="team">
              👥 Team (${TEAM_DEMO_USERS.length})
            </button>
          </nav>

          <div class="search-box">
            <span class="s-icon">🔍</span>
            <input id="global-search" type="search" value="${esc(f.q)}" placeholder="Search reels, prompts, tools, hooks…">
            <kbd>/</kbd>
          </div>

          <div class="header-right">
            <button class="icon-btn ${state.layout === 'grid' ? 'active' : ''}" data-layout="grid" title="Grid view">⊞</button>
            <button class="icon-btn ${state.layout === 'list' ? 'active' : ''}" data-layout="list" title="Compact list">☰</button>
            <button class="icon-btn" id="btn-theme" title="Toggle Dark / Light mode">${state.theme === 'dark' ? '☀️' : '🌙'}</button>
            <div class="user-pill">
              <span class="avatar" style="background:${esc(state.user.color || '#2563EB')}">${esc(initials(state.user.name))}</span>
              <span>${esc(state.user.name.replace(/\s*\(Admin\)/i, ''))}</span>
              <button class="icon-btn" id="btn-logout" title="Switch account / Sign out" style="padding:3px 7px;border:none">↪</button>
            </div>
          </div>
        </div>
      </header>

      <main class="page-container">
        ${renderMainView()}
      </main>
    </div>
  `;

  bindShellEvents();
}

function renderMainView() {
  if (state.view === 'prompts') return renderPromptsView();
  if (state.view === 'hooks') return renderHooksView();
  if (state.view === 'tools') return renderToolsView();
  if (state.view === 'team') return renderTeamView();
  return renderVaultView();
}

// ---------- Frictionless 2-Box Quick Drop + Vault Feed ----------
function renderVaultView() {
  const f = state.filters;
  const activeFiltersCount = ['platform', 'category', 'type', 'status', 'resource', 'tag', 'fav', 'pending', 'collection', 'sharer', 'q']
    .filter(k => f[k]).length;

  return `
    <!-- 2-Second Share Bar: Just Paste Reel Link + Paste Prompt/Tool -->
    <form class="quick-composer" id="instant-drop-form">
      <div class="qc-top">
        <div class="qc-title">
          <span>⚡ Quick Drop to Vault</span>
          <span class="qc-badge">Auto-Detects Video, Summary, Hook &amp; How to Use It</span>
        </div>
        <button type="button" class="btn btn-sm" id="btn-open-upload">📎 Or Upload Video / File</button>
      </div>
      <div class="qc-grid">
        <input class="qc-input" id="qc-url" placeholder="1. Paste Reel / Post / YouTube / TikTok / Skool link…" autocomplete="off">
        <input class="qc-input" id="qc-prompt" placeholder="2. Paste Prompt, Drive/Tool link, or 'Comment KEYWORD' (optional)…" autocomplete="off">
        <button type="submit" class="qc-submit" id="qc-submit-btn">Save to Vault →</button>
      </div>
      <div class="qc-foot">
        <span id="qc-live-hint">Just paste &amp; hit Enter — the Vault fetches the video for inline playback and writes the full breakdown automatically.</span>
      </div>
    </form>

    <div class="filter-bar">
      <div class="filter-chips">
        <button class="chip ${!f.platform && !f.fav && !f.pending ? 'active' : ''}" data-plat="">All (${state.stats?.total || 0})</button>
        <button class="chip ${f.fav === '1' ? 'active' : ''}" data-nav="fav">⭐ Starred</button>
        <button class="chip ${f.pending === '1' ? 'active' : ''}" data-nav="pending">💬 Need Comment / DM</button>
        ${['instagram', 'facebook', 'youtube', 'tiktok', 'skool', 'drive'].map(p => {
          const info = PLATFORMS[p];
          return `<button class="chip ${f.platform === p ? 'active' : ''}" data-plat="${p}">${esc(info.label)}</button>`;
        }).join('')}
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
        <select class="filter-select" id="flt-collection">
          <option value="">All Collections</option>
          ${state.collections.map(c => `<option value="${c.id}" ${String(f.collection) === String(c.id) ? 'selected' : ''}>${esc(c.emoji || '📁')} ${esc(c.name)} (${c.n || 0})</option>`).join('')}
        </select>

        <select class="filter-select" id="flt-category">
          <option value="">All Categories</option>
          ${CATEGORIES.map(c => `<option value="${esc(c)}" ${f.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>

        <select class="filter-select" id="flt-sort">
          <option value="newest" ${f.sort === 'newest' ? 'selected' : ''}>Newest First</option>
          <option value="top" ${f.sort === 'top' ? 'selected' : ''}>Most Upvoted</option>
          <option value="useful" ${f.sort === 'useful' ? 'selected' : ''}>Top Rated</option>
        </select>

        ${activeFiltersCount ? `<button class="btn btn-sm" id="btn-clear-filters">✕ Reset (${activeFiltersCount})</button>` : ''}
      </div>
    </div>

    ${state.items.length === 0 ? `
      <div class="empty-state">
        <div style="font-size:38px">🎬</div>
        <h3>Nothing here yet</h3>
        <p>Paste any Facebook/Instagram Reel, YouTube Short, or prompt in the Quick Drop bar above.</p>
        ${activeFiltersCount ? `<button class="btn" id="btn-empty-reset">Clear Filters</button>` : ''}
      </div>
    ` : state.layout === 'list' ? `
      <div class="vault-list">
        ${state.items.map(renderItemRow).join('')}
      </div>
    ` : `
      <div class="vault-grid">
        ${state.items.map(renderItemCard).join('')}
      </div>
    `}
  `;
}

function renderItemCard(item) {
  const plat = PLATFORMS[item.platform] || PLATFORMS.web;
  const ctype = CONTENT_TYPES[item.content_type] || 'Post';
  const hasPlayableVideo = Boolean(item.media_url && (item.media_mime || '').startsWith('video/'));

  return `
    <article class="vcard" data-open-item="${item.id}">
      <div class="vcard-media">
        ${hasPlayableVideo ? `
          <video src="${esc(item.media_url)}" ${item.thumb ? `poster="${esc(item.thumb)}"` : ''} preload="metadata" muted loop playsinline data-hover-video="1"></video>
        ` : item.thumb ? `
          <img src="${esc(item.thumb)}" alt="${esc(item.title)}" loading="lazy">
        ` : `
          <div class="vcard-fallback">
            <div class="vf-hook bn">${esc(item.hook_text || item.title)}</div>
          </div>
        `}
        <div class="vcard-badges-top">
          <span class="platform-pill" style="background:${plat.color}">${esc(plat.label)}</span>
          <span class="type-pill">${esc(ctype)}</span>
        </div>
        <div class="play-overlay" title="Click to watch & view breakdown">▶</div>
        <div class="vcard-badges-bottom">
          ${hasPlayableVideo ? `<span class="offline-badge">▶ Instant HD Player</span>` : (item.archive_status === 'processing' ? `<span class="score-badge">⏳ Fetching Video…</span>` : `<span></span>`)}
          ${item.usefulness ? `<span class="score-badge">★ ${item.usefulness}/10</span>` : ''}
        </div>
      </div>

      <div class="vcard-body">
        <div class="vcard-meta-row">
          <span class="cat-badge">${esc(item.category)}</span>
          <span class="status-dot status-${esc(item.status)}">${esc(STATUSES[item.status] || item.status)}</span>
        </div>

        <h3 class="vcard-title bn">${esc(item.title || 'Shared Content')}</h3>

        <div class="vcard-what">
          <div class="vcard-what-text"><strong>What it does:</strong> ${esc(item.what_it_does || item.summary || item.hook_text || 'Auto-analyzing content…')}</div>
        </div>

        ${item.comment_keyword ? `
          <div class="kw-banner ${item.resource_status === 'received' ? 'done' : ''}">
            <span>💬 Comment "${esc(item.comment_keyword)}"</span>
            <span style="margin-left:auto">${item.resource_status === 'received' ? '✓ Saved' : '⏳ Need DM'}</span>
          </div>
        ` : ''}

        <div class="vcard-foot">
          <span>
            ${item.shared_by ? esc(item.shared_by.name) : 'Team'} · ${relTime(item.created_at)}
          </span>
          <div class="vcard-actions">
            ${item.resources ? `<span class="act-btn" title="Attached prompts/tools">🧰 ${item.resources}</span>` : ''}
            <button type="button" class="act-btn ${item.upvoted ? 'active-up' : ''}" data-upvote="${item.id}">
              ▲ ${item.upvotes || 0}
            </button>
            <button type="button" class="act-btn ${item.favorite ? 'active-fav' : ''}" data-fav="${item.id}">
              ${item.favorite ? '★' : '☆'}
            </button>
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderItemRow(item) {
  const plat = PLATFORMS[item.platform] || PLATFORMS.web;
  return `
    <div class="vrow" data-open-item="${item.id}">
      ${item.thumb ? `<img class="vrow-thumb" src="${esc(item.thumb)}" alt="">` : `<div class="vrow-thumb" style="display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800">▶</div>`}
      <div style="flex:1;min-width:0">
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:3px">
          <span class="platform-pill" style="background:${plat.color};font-size:10px;padding:2px 8px">${esc(plat.label)}</span>
          <span class="cat-badge">${esc(item.category)}</span>
        </div>
        <div style="font-weight:800;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" class="bn">${esc(item.title)}</div>
        <div style="font-size:12px;color:var(--mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(item.what_it_does || item.summary || '')}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <button type="button" class="act-btn ${item.upvoted ? 'active-up' : ''}" data-upvote="${item.id}">▲ ${item.upvotes || 0}</button>
        <button type="button" class="act-btn ${item.favorite ? 'active-fav' : ''}" data-fav="${item.id}">${item.favorite ? '★' : '☆'}</button>
      </div>
    </div>
  `;
}

// ---------- Libraries ----------
function renderPromptsView() {
  return `
    <div style="margin-bottom:18px">
      <h2 style="margin:0;font-size:21px;font-weight:800">✨ Team Prompt Library</h2>
      <p style="margin:3px 0 0;color:var(--mute)">All AI prompts shared by the team—1-click copy.</p>
    </div>
    ${state.prompts.length === 0 ? `<div class="empty-state"><h3>No prompts yet</h3></div>` : `
      <div class="vault-grid">
        ${state.prompts.map((p, idx) => `
          <div class="lib-card">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span class="cat-badge">${esc(p.category || 'Prompt')}</span>
              <span style="font-size:11.5px;color:var(--mute)">Shared by ${esc(p.author || 'Team')}</span>
            </div>
            <h3 style="margin:0;font-size:15px;font-weight:800">${esc(p.title || p.item_title)}</h3>
            <div class="prompt-block">${esc(p.content)}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:auto;padding-top:8px">
              <button class="btn btn-sm" data-open-item="${p.item_id}">▶ Watch Source Video</button>
              <button class="btn btn-sm btn-primary" data-copy-prompt="${idx}">📋 Copy Prompt</button>
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;
}

function renderHooksView() {
  return `
    <div style="margin-bottom:18px">
      <h2 style="margin:0;font-size:21px;font-weight:800">🎯 Scroll-Stopping Hooks &amp; Payoffs</h2>
      <p style="margin:3px 0 0;color:var(--mute)">Extracted opening hooks, why they work, and Bangla adaptations.</p>
    </div>
    ${state.hooks.length === 0 ? `<div class="empty-state"><h3>No analyzed hooks yet</h3></div>` : `
      <div class="vault-grid">
        ${state.hooks.map(h => `
          <div class="lib-card">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span class="cat-badge">${esc(h.hook.type || 'Hook')}</span>
              ${h.usefulness ? `<span class="score-badge">★ ${h.usefulness}/10</span>` : ''}
            </div>
            <div class="vcard-what bn" style="font-size:14px;font-weight:700">"${esc(h.hook.text)}"</div>
            ${h.hook.why_it_works ? `<div style="font-size:12.5px;color:var(--ink-2)"><strong>Why it works:</strong> ${esc(h.hook.why_it_works)}</div>` : ''}
            ${h.payoff ? `<div style="font-size:12.5px;color:var(--green)"><strong>Payoff:</strong> ${esc(h.payoff)}</div>` : ''}
            ${(h.bangla_hooks || []).length ? `
              <div style="background:var(--surface-2);padding:10px 12px;border-radius:10px;border:1px solid var(--border)">
                <div style="font-size:11px;font-weight:800;color:var(--primary);text-transform:uppercase;margin-bottom:4px">🇧🇩 Bangla Hook Ideas</div>
                <ul style="margin:0;padding-left:16px;font-size:12.5px" class="bn">
                  ${h.bangla_hooks.map(bh => `<li>${esc(bh)}</li>`).join('')}
                </ul>
              </div>
            ` : ''}
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:auto;padding-top:8px">
              <button class="btn btn-sm" data-open-item="${h.item_id}">▶ Open Video</button>
              <button class="btn btn-sm" data-copy-text="${esc(h.hook.text)}">📋 Copy Hook</button>
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;
}

function renderToolsView() {
  return `
    <div style="margin-bottom:18px">
      <h2 style="margin:0;font-size:21px;font-weight:800">🧰 Tools, Drive Folders &amp; Links</h2>
      <p style="margin:3px 0 0;color:var(--mute)">Every tool, Drive link, and Skool resource shared by the team.</p>
    </div>
    ${state.tools.length === 0 ? `<div class="empty-state"><h3>No tools saved yet</h3></div>` : `
      <div class="vault-grid">
        ${state.tools.map(t => `
          <div class="lib-card">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span class="cat-badge">${esc(RESOURCE_KINDS[t.kind] || t.kind || 'Tool')}</span>
              <span style="font-size:11.5px;color:var(--mute)">${esc(t.item_title)}</span>
            </div>
            <h3 style="margin:0;font-size:15.5px;font-weight:800">${esc(t.title || 'Resource')}</h3>
            ${t.content ? `<p style="margin:0;font-size:13px;color:var(--ink-2);white-space:pre-wrap">${esc(t.content)}</p>` : ''}
            <div style="display:flex;gap:8px;margin-top:auto;padding-top:8px">
              <button class="btn btn-sm" data-open-item="${t.item_id}">▶ Open Video</button>
              ${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener" class="btn btn-sm btn-primary">↗ Open Link</a>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;
}

function renderTeamView() {
  const { members, inviteCode } = state.team;
  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:18px">
      <div class="lib-card">
        <h3 style="margin:0;font-size:17px;font-weight:800">👥 BMDGL Team Members (${members.length})</h3>
        ${inviteCode ? `
          <div class="info-box" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
            <div>
              <div style="font-size:11px;font-weight:800;color:var(--mute);text-transform:uppercase">Team Invite Code</div>
              <div style="font-family:var(--font-mono);font-size:16px;font-weight:800;color:var(--primary)">${esc(inviteCode)}</div>
            </div>
            <button class="btn btn-sm btn-primary" data-copy-text="${esc(inviteCode)}">Copy</button>
          </div>
        ` : ''}
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
          ${members.map(m => `
            <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface-2)">
              <span class="avatar" style="background:${esc(m.color)}">${esc(initials(m.name))}</span>
              <div style="flex:1">
                <div style="font-weight:700">${esc(m.name)} <span style="font-size:11px;color:var(--mute)">(${esc(m.role)})</span></div>
                <div style="font-size:11.5px;color:var(--mute)">${esc(m.email)} · ${m.shared || 0} shared</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="lib-card">
        <h3 style="margin:0;font-size:17px;font-weight:800">📦 Export &amp; Backups</h3>
        <p style="margin:0;color:var(--mute);font-size:12.5px">Export the team's swipe file to Excel / Google Sheets or JSON.</p>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">
          <a href="/api/export.csv" class="btn btn-primary" style="justify-content:flex-start;padding:12px 14px">
            📊 Export Swipe File to CSV (Excel / Sheets)
          </a>
          ${state.user.role === 'admin' ? `
            <a href="/api/export.json" class="btn" style="justify-content:flex-start;padding:12px 14px">
              🗄️ Download Full JSON Backup
            </a>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

// ---------- Upload File Modal (Simple) ----------
function openUploadModal() {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop" id="upload-backdrop">
      <div class="modal-dialog" style="max-width:500px">
        <div class="modal-head">
          <h3>📎 Upload Video, Screenshot or File</h3>
          <button class="icon-btn" id="btn-close-upload">✕</button>
        </div>
        <form id="simple-upload-form" class="modal-body">
          <div class="field">
            <label>Choose Video (.mp4, .mov), Image or PDF</label>
            <input type="file" id="up-files" required multiple accept=".mp4,.mov,.webm,.jpg,.jpeg,.png,.webp,.pdf,.txt,.docx">
          </div>
          <div class="field">
            <label>Paste Prompt / Tool Link / Note (optional)</label>
            <textarea name="promptInput" rows="3" placeholder="Paste the prompt or tool used in this content…"></textarea>
          </div>
          <button type="submit" class="btn btn-primary" id="btn-do-upload" style="width:100%;padding:11px">Upload &amp; Auto-Analyze →</button>
        </form>
      </div>
    </div>
  `;
  const close = () => { root.innerHTML = ''; };
  root.querySelector('#btn-close-upload').addEventListener('click', close);
  root.querySelector('#upload-backdrop').addEventListener('click', (e) => { if (e.target.id === 'upload-backdrop') close(); });
  root.querySelector('#simple-upload-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = root.querySelector('#btn-do-upload');
    btn.disabled = true;
    btn.textContent = 'Uploading…';
    try {
      const parsed = parseSmartResourceInput(e.target.promptInput.value);
      const fd = new FormData();
      fd.append('data', JSON.stringify(parsed));
      for (const f of root.querySelector('#up-files').files) fd.append('files', f);
      const res = await api('/api/items', { method: 'POST', body: fd });
      close();
      toast('✓ Uploaded & analyzed!');
      await loadAllData();
      openItemDetail(res.item.id);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Upload & Auto-Analyze →';
      toast(err.message, true);
    }
  });
}

// ---------- Item Detail Theater Modal ----------
async function openItemDetail(id) {
  try {
    const res = await api(`/api/items/${id}`);
    state.activeItem = res.item;
    state.activeTab = 'breakdown';
    state.stageMode = 'auto';
    renderModal();
    scheduleBackgroundPoll();
  } catch (e) {
    toast(e.message, true);
  }
}

function renderStagePlayer(item) {
  const info = item.canonical_url ? analyzeUrl(item.canonical_url) : null;
  const hasOffline = Boolean(item.media?.url && ((item.media.mime || '').startsWith('video/') || (item.media.mime || '').startsWith('image/')));
  const hasEmbed = Boolean(info && info.embed && info.embed.kind !== 'none');

  let mode = state.stageMode;
  if (mode === 'auto') {
    mode = hasOffline ? 'offline' : (hasEmbed ? 'embed' : 'fallback');
  }

  let viewportHtml = '';
  if (mode === 'offline' && hasOffline) {
    if ((item.media.mime || '').startsWith('image/')) {
      viewportHtml = `<img src="${esc(item.media.url)}" alt="${esc(item.title)}">`;
    } else {
      viewportHtml = `<video id="stage-video-el" src="${esc(item.media.url)}" controls autoplay playsinline preload="auto" ${item.thumb ? `poster="${esc(item.thumb)}"` : ''}></video>`;
    }
  } else if (mode === 'embed' && hasEmbed) {
    if (info.embed.kind === 'video') {
      viewportHtml = `<video src="${esc(info.embed.src)}" controls autoplay playsinline></video>`;
    } else if (info.embed.kind === 'image') {
      viewportHtml = `<img src="${esc(info.embed.src)}" alt="${esc(item.title)}">`;
    } else {
      viewportHtml = `<iframe src="${esc(info.embed.src)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    }
  } else {
    viewportHtml = `
      <div style="text-align:center;padding:28px;max-width:420px">
        ${item.thumb ? `<img src="${esc(item.thumb)}" alt="" style="max-height:240px;border-radius:10px;margin-bottom:14px">` : `<div style="font-size:38px;margin-bottom:8px">🎬</div>`}
        <div style="font-weight:800;font-size:15px;margin-bottom:6px" class="bn">${esc(item.title)}</div>
        <p style="color:#94A3B8;font-size:12.5px;margin-bottom:14px">
          ${item.archive_status === 'processing' ? '⏳ Downloading HD video into the Vault right now — it will start playing automatically in a few seconds…' : 'Open the link or click below to pull the offline HD video into the Vault.'}
        </p>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
          ${item.canonical_url ? `<a href="${esc(item.canonical_url)}" target="_blank" rel="noopener" class="btn btn-primary">↗ Open Original</a>` : ''}
          ${state.boot?.features?.archive && item.canonical_url && item.archive_status !== 'processing' ? `<button class="btn" id="btn-stage-archive">⬇️ Fetch HD Video into Player</button>` : ''}
        </div>
      </div>
    `;
  }

  return `
    <div class="detail-stage">
      <div class="stage-toolbar">
        <div class="stage-modes">
          ${hasOffline ? `<button type="button" class="${mode === 'offline' ? 'active' : ''}" data-stage-mode="offline">▶ Instant HD Player</button>` : ''}
          ${hasEmbed ? `<button type="button" class="${mode === 'embed' ? 'active' : ''}" data-stage-mode="embed">🌐 Platform Embed</button>` : ''}
        </div>
        <div>
          ${!hasOffline && state.boot?.features?.archive && item.canonical_url ? `
            <button type="button" class="btn btn-sm" id="btn-stage-archive">
              ${item.archive_status === 'processing' ? '⏳ Fetching Video…' : '⬇️ Fetch HD Video'}
            </button>
          ` : ''}
        </div>
      </div>
      <div class="stage-viewport">
        ${viewportHtml}
      </div>
      <div class="stage-foot">
        <span>${esc(PLATFORMS[item.platform]?.label || item.platform)} · ${esc(CONTENT_TYPES[item.content_type] || item.content_type)}${item.author_name ? ` · ${esc(item.author_name)}` : ''}</span>
        ${item.canonical_url ? `<a href="${esc(item.canonical_url)}" target="_blank" rel="noopener">↗ Open Original Link</a>` : ''}
      </div>
    </div>
  `;
}

function renderModal() {
  const root = document.getElementById('modal-root');
  const item = state.activeItem;
  if (!item) { root.innerHTML = ''; return; }
  const ai = item.ai || {};
  const hook = ai.hook || { text: item.hook_text || '' };
  const story = ai.story || { structure: '', beats: [] };

  root.innerHTML = `
    <div class="modal-backdrop" id="detail-backdrop">
      <div class="modal-dialog xl">
        <div class="modal-head">
          <div style="display:flex;align-items:center;gap:10px;min-width:0">
            <span class="platform-pill" style="background:${(PLATFORMS[item.platform] || PLATFORMS.web).color}">${esc((PLATFORMS[item.platform] || PLATFORMS.web).label)}</span>
            <h3 class="bn" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(item.title)}</h3>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
            <select id="detail-status-select" class="filter-select">
              ${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}" ${item.status === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
            </select>
            <button class="act-btn ${item.upvoted ? 'active-up' : ''}" id="detail-upvote">▲ ${item.upvotes || 0}</button>
            <button class="act-btn ${item.favorite ? 'active-fav' : ''}" id="detail-fav">${item.favorite ? '★' : '☆'}</button>
            <button class="icon-btn" id="detail-close">✕</button>
          </div>
        </div>

        <div class="detail-split">
          ${renderStagePlayer(item)}

          <div class="detail-pane">
            <div class="detail-tabs">
              <button type="button" class="${state.activeTab === 'breakdown' ? 'active' : ''}" data-dtab="breakdown">🎯 Summary &amp; How to Use It</button>
              <button type="button" class="${state.activeTab === 'resources' ? 'active' : ''}" data-dtab="resources">🧰 Prompts &amp; Tools (${(item.resources_list?.length || 0) + (item.attachments?.length || 0)})</button>
              <button type="button" class="${state.activeTab === 'discussion' ? 'active' : ''}" data-dtab="discussion">💬 Team Notes (${item.comments_list?.length || 0})</button>
              <button type="button" class="${state.activeTab === 'edit' ? 'active' : ''}" data-dtab="edit">✏️ Edit</button>
            </div>

            ${state.activeTab === 'breakdown' ? `
              ${item.comment_keyword ? `
                <div class="kw-banner ${item.resource_status === 'received' ? 'done' : ''}" style="padding:10px 14px;font-size:13px">
                  <span>💬 Creator CTA: <strong>Comment "${esc(item.comment_keyword)}"</strong></span>
                  <select id="detail-res-status" class="filter-select" style="margin-left:auto;padding:4px 8px">
                    ${Object.entries(RESOURCE_STATUSES).map(([k, v]) => `<option value="${k}" ${item.resource_status === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
                  </select>
                </div>
              ` : ''}

              <div class="info-box">
                <h4>
                  <span>📋 What It Is &amp; How We Use It</span>
                  ${item.usefulness ? `<span class="score-badge">★ ${item.usefulness}/10</span>` : ''}
                </h4>
                <p style="margin:0 0 8px;font-size:13.8px;color:var(--ink)"><strong>Summary:</strong> ${esc(item.summary || ai.summary || item.caption || 'Auto-generated summary ready.')}</p>
                <p style="margin:0;font-size:13.8px;color:var(--primary)"><strong>What it can do for BMDGL:</strong> ${esc(item.what_it_does || ai.what_it_does || item.notes || 'Gives our team a proven hook/story/payoff format and reusable workflow.')}</p>
              </div>

              ${(item.resources_list || []).length ? `
                <div class="info-box" style="border-color:var(--primary)">
                  <h4>
                    <span>✨ Attached Prompt / Tool</span>
                    ${item.resources_list[0].content ? `<button class="btn btn-sm btn-primary" data-copy-text="${esc(item.resources_list[0].content)}">📋 Copy Prompt</button>` : ''}
                  </h4>
                  ${item.resources_list[0].content ? `<div class="prompt-block">${esc(item.resources_list[0].content)}</div>` : ''}
                  ${item.resources_list[0].url ? `<div style="margin-top:8px"><a href="${esc(item.resources_list[0].url)}" target="_blank" rel="noopener" class="btn btn-sm btn-primary">↗ Open Tool / Drive Link</a></div>` : ''}
                </div>
              ` : ''}

              <div class="hsp-grid">
                <div class="hsp-card hook">
                  <div class="hsp-kicker">
                    <span>1. Scroll-Stopping Hook (0–3s)</span>
                    <span>${esc(hook.type || 'Opening Hook')}</span>
                  </div>
                  <div style="font-size:14.5px;font-weight:800;margin-bottom:4px" class="bn">"${esc(hook.text || item.title)}"</div>
                  ${hook.why_it_works ? `<div style="font-size:12.5px;color:var(--mute)"><strong>Why it works:</strong> ${esc(hook.why_it_works)}</div>` : ''}
                </div>

                <div class="hsp-card story">
                  <div class="hsp-kicker"><span>2. Story Structure &amp; Pacing</span></div>
                  <div style="font-weight:700;font-size:13px;margin-bottom:6px">${esc(story.structure || 'Hook → Problem → Solution Demo → CTA')}</div>
                  ${(story.beats || []).length ? `
                    <ul style="margin:0;padding-left:18px;font-size:12.5px;color:var(--ink-2)">
                      ${story.beats.map(b => `<li>${esc(b)}</li>`).join('')}
                    </ul>
                  ` : ''}
                </div>

                <div class="hsp-card payoff">
                  <div class="hsp-kicker"><span>3. Payoff &amp; Bangla Hook Ideas</span></div>
                  <div style="font-size:13px;margin-bottom:8px"><strong>Payoff:</strong> ${esc(ai.payoff || 'Concrete tool/workflow delivered fast.')}</div>
                  ${(ai.bangla_hooks || []).length ? `
                    <div style="display:flex;flex-direction:column;gap:6px">
                      ${ai.bangla_hooks.map(bh => `
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;background:var(--surface-2);padding:7px 10px;border-radius:8px">
                          <span class="bn" style="font-weight:700;font-size:13px">${esc(bh)}</span>
                          <button class="btn btn-sm" data-copy-text="${esc(bh)}">Copy</button>
                        </div>
                      `).join('')}
                    </div>
                  ` : ''}
                </div>
              </div>
            ` : ''}

            ${state.activeTab === 'resources' ? `
              ${(item.resources_list || []).map(r => `
                <div class="info-box">
                  <h4>
                    <span><span class="cat-badge">${esc(RESOURCE_KINDS[r.kind] || r.kind)}</span> ${esc(r.title || 'Resource')}</span>
                    <div style="display:flex;gap:6px">
                      ${r.content ? `<button class="btn btn-sm btn-primary" data-copy-text="${esc(r.content)}">📋 Copy</button>` : ''}
                      ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener" class="btn btn-sm">↗ Open</a>` : ''}
                      <button class="btn btn-sm btn-danger" data-del-res="${r.id}">✕</button>
                    </div>
                  </h4>
                  ${r.content ? `<div class="prompt-block">${esc(r.content)}</div>` : ''}
                  ${r.url ? `<div style="font-size:12px;margin-top:6px"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a></div>` : ''}
                </div>
              `).join('')}

              <form id="add-res-form" class="info-box">
                <h4>＋ Add Another Prompt or Tool Link</h4>
                <div class="field">
                  <input name="title" placeholder="Title (optional, e.g. Claude Prompt / Drive Folder)">
                </div>
                <div class="field">
                  <textarea name="content" rows="3" placeholder="Paste prompt text or instructions…"></textarea>
                </div>
                <div class="field">
                  <input name="url" placeholder="Or paste tool / Google Drive / Skool URL (https://…)">
                </div>
                <button type="submit" class="btn btn-primary btn-sm">Save Prompt / Tool</button>
              </form>
            ` : ''}

            ${state.activeTab === 'discussion' ? `
              <div style="display:flex;flex-direction:column;gap:8px">
                ${(item.comments_list || []).map(c => `
                  <div class="info-box" style="padding:10px 13px">
                    <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--mute);margin-bottom:4px">
                      <strong>${esc(c.name || 'Teammate')}</strong>
                      <span>${relTime(c.created_at)}</span>
                    </div>
                    <div style="white-space:pre-wrap;font-size:13px">${esc(c.body)}</div>
                  </div>
                `).join('')}
              </div>

              <form id="comment-form" style="display:flex;gap:8px">
                <input name="body" required placeholder="Write a quick note for the team…" style="flex:1;padding:10px 13px;border-radius:10px;border:1px solid var(--border);background:var(--bg);color:var(--ink)">
                <button type="submit" class="btn btn-primary">Send</button>
              </form>
            ` : ''}

            ${state.activeTab === 'edit' ? `
              <form id="edit-item-form">
                <div class="field">
                  <label>Title</label>
                  <input name="title" value="${esc(item.title)}">
                </div>
                <div class="field">
                  <label>Category</label>
                  <select name="category">
                    ${CATEGORIES.map(c => `<option value="${esc(c)}" ${item.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
                  </select>
                </div>
                <div class="field">
                  <label>Summary</label>
                  <textarea name="summary" rows="2">${esc(item.summary || '')}</textarea>
                </div>
                <div class="field">
                  <label>What It Can Do for BMDGL</label>
                  <textarea name="what_it_does" rows="2">${esc(item.what_it_does || '')}</textarea>
                </div>
                <div style="display:flex;justify-content:space-between;margin-top:12px">
                  <button type="button" class="btn btn-danger" id="btn-delete-item">🗑️ Delete</button>
                  <div style="display:flex;gap:8px">
                    <button type="button" class="btn" id="btn-reanalyze">⚡ Auto-Regenerate Breakdown</button>
                    <button type="submit" class="btn btn-primary">Save</button>
                  </div>
                </div>
              </form>
            ` : ''}
          </div>
        </div>
      </div>
    </div>
  `;

  bindModalEvents(root, item);
}

function bindModalEvents(root, item) {
  const close = () => {
    state.activeItem = null;
    root.innerHTML = '';
    if (location.hash.startsWith('#/item/')) history.replaceState(null, '', '#/');
  };
  root.querySelector('#detail-close')?.addEventListener('click', close);
  root.querySelector('#detail-backdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'detail-backdrop') close();
  });

  // Ensure HTML5 video plays smoothly even if browser blocks unmuted autoplay
  const vid = root.querySelector('#stage-video-el');
  if (vid) {
    vid.play().catch(() => {
      vid.muted = true;
      vid.play().catch(() => {});
    });
  }

  root.querySelectorAll('[data-stage-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.stageMode = btn.dataset.stageMode;
      renderModal();
    });
  });

  root.querySelectorAll('[data-dtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.dtab;
      renderModal();
    });
  });

  root.querySelectorAll('[data-copy-text]').forEach(btn => {
    btn.addEventListener('click', () => copyText(btn.dataset.copyText));
  });

  root.querySelector('#detail-status-select')?.addEventListener('change', async (e) => {
    const res = await api(`/api/items/${item.id}`, { method: 'PATCH', body: { status: e.target.value } });
    state.activeItem = res.item;
    toast(`Status updated to ${STATUSES[e.target.value]}`);
    await loadAllData();
  });

  root.querySelector('#detail-res-status')?.addEventListener('change', async (e) => {
    const res = await api(`/api/items/${item.id}`, { method: 'PATCH', body: { resource_status: e.target.value } });
    state.activeItem = res.item;
    toast('Updated');
    await loadAllData();
    renderModal();
  });

  root.querySelector('#detail-upvote')?.addEventListener('click', async () => {
    const res = await api(`/api/items/${item.id}/upvote`, { method: 'POST' });
    state.activeItem.upvoted = res.upvoted;
    state.activeItem.upvotes = res.upvotes;
    renderModal();
    loadItems();
  });

  root.querySelector('#detail-fav')?.addEventListener('click', async () => {
    const res = await api(`/api/items/${item.id}/favorite`, { method: 'POST' });
    state.activeItem.favorite = res.favorite;
    renderModal();
    loadAllData();
  });

  root.querySelector('#btn-stage-archive')?.addEventListener('click', async () => {
    try {
      const res = await api(`/api/items/${item.id}/archive`, { method: 'POST' });
      state.activeItem = res.item;
      toast('Fetching HD video into Vault…');
      renderModal();
      scheduleBackgroundPoll();
    } catch (e) { toast(e.message, true); }
  });

  root.querySelector('#add-res-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const url = (fd.get('url') || '').trim();
    const content = (fd.get('content') || '').trim();
    const title = (fd.get('title') || '').trim() || (url ? 'Tool / Resource Link' : 'Prompt');
    const kind = url ? (/drive\.google/i.test(url) ? 'drive' : 'tool') : 'prompt';
    try {
      const res = await api(`/api/items/${item.id}/resources`, { method: 'POST', body: { kind, title, content, url } });
      state.activeItem = res.item;
      toast('✓ Saved');
      renderModal();
      loadAllData();
    } catch (err) { toast(err.message, true); }
  });

  root.querySelectorAll('[data-del-res]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const res = await api(`/api/resources/${btn.dataset.delRes}`, { method: 'DELETE' });
      state.activeItem = res.item;
      renderModal();
      loadAllData();
    });
  });

  root.querySelector('#comment-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = e.target.body.value.trim();
    if (!body) return;
    const res = await api(`/api/items/${item.id}/comments`, { method: 'POST', body: { body } });
    state.activeItem = res.item;
    renderModal();
  });

  root.querySelector('#edit-item-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const res = await api(`/api/items/${item.id}`, { method: 'PATCH', body: Object.fromEntries(fd.entries()) });
    state.activeItem = res.item;
    toast('✓ Saved');
    renderModal();
    loadAllData();
  });

  root.querySelector('#btn-reanalyze')?.addEventListener('click', async () => {
    try {
      const res = await api(`/api/items/${item.id}/reanalyze`, { method: 'POST' });
      state.activeItem = res.item;
      toast('Auto-generating breakdown…');
      renderModal();
      scheduleBackgroundPoll();
    } catch (e) { toast(e.message, true); }
  });

  root.querySelector('#btn-delete-item')?.addEventListener('click', async () => {
    if (!confirm('Delete this item from the Vault?')) return;
    try {
      await api(`/api/items/${item.id}`, { method: 'DELETE' });
      close();
      toast('Deleted');
      loadAllData();
    } catch (e) { toast(e.message, true); }
  });
}

// ---------- Shell Events ----------
let searchTimer = null;
function bindShellEvents() {
  const app = document.getElementById('app');

  app.querySelector('#btn-mobile-menu')?.addEventListener('click', () => {
    state.sidebarOpen = !state.sidebarOpen;
    renderApp();
  });
  app.querySelector('#sb-backdrop')?.addEventListener('click', () => {
    state.sidebarOpen = false;
    renderApp();
  });

  app.querySelector('#btn-open-upload')?.addEventListener('click', () => openUploadModal());

  // Frictionless 2-Box Quick Drop Submit
  const dropForm = app.querySelector('#instant-drop-form');
  const qcUrl = app.querySelector('#qc-url');
  const qcHint = app.querySelector('#qc-live-hint');

  qcUrl?.addEventListener('input', () => {
    const info = analyzeUrl(extractUrl(qcUrl.value) || qcUrl.value.trim());
    if (info && qcHint) {
      const plat = PLATFORMS[info.platform] || PLATFORMS.web;
      qcHint.innerHTML = `<span style="color:var(--green);font-weight:700">✓ ${esc(plat.label)} ${esc(CONTENT_TYPES[info.contentType] || 'Link')} detected</span> — hit Enter or click Save to pull video &amp; auto-generate breakdown.`;
    }
  });

  dropForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawUrl = (app.querySelector('#qc-url')?.value || '').trim();
    const rawPrompt = (app.querySelector('#qc-prompt')?.value || '').trim();
    if (!rawUrl && !rawPrompt) {
      toast('Paste a Reel/video link or a prompt first!', true);
      return;
    }
    const btn = app.querySelector('#qc-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const parsed = parseSmartResourceInput(rawPrompt);
      const res = await api('/api/items', {
        method: 'POST',
        body: {
          url: extractUrl(rawUrl) || rawUrl,
          ...parsed,
        },
      });
      toast('✓ Saved to Vault! Fetching video & breakdown…');
      await loadAllData();
      openItemDetail(res.item.id);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Save to Vault →';
      toast(err.message, true);
    }
  });

  const resetFilters = () => {
    state.view = 'vault';
    for (const k of Object.keys(state.filters)) if (k !== 'sort') state.filters[k] = '';
    loadItems();
  };
  app.querySelector('#btn-clear-filters')?.addEventListener('click', resetFilters);
  app.querySelector('#btn-empty-reset')?.addEventListener('click', resetFilters);

  app.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.sidebarOpen = false;
      state.view = 'vault';
      for (const k of Object.keys(state.filters)) if (k !== 'sort' && k !== 'q') state.filters[k] = '';
      const nav = btn.dataset.nav;
      if (nav === 'fav') state.filters.fav = '1';
      else if (nav === 'pending') state.filters.pending = '1';
      else if (nav === 'testing') state.filters.status = 'testing';
      else if (nav === 'used') state.filters.status = 'used';
      loadItems();
    });
  });

  app.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', async () => {
      state.sidebarOpen = false;
      const v = btn.dataset.view;
      state.view = v;
      if (v === 'prompts') state.prompts = (await api('/api/library/prompts')).prompts || [];
      else if (v === 'hooks') state.hooks = (await api('/api/library/hooks')).hooks || [];
      else if (v === 'tools') state.tools = (await api('/api/library/tools')).tools || [];
      else if (v === 'team') state.team = await api('/api/team');
      renderApp();
    });
  });

  app.querySelectorAll('[data-collection]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.sidebarOpen = false;
      state.view = 'vault';
      for (const k of Object.keys(state.filters)) if (k !== 'sort') state.filters[k] = '';
      state.filters.collection = btn.dataset.collection;
      loadItems();
    });
  });

  app.querySelector('#btn-new-collection')?.addEventListener('click', async () => {
    const name = prompt('New collection name:');
    if (!name || !name.trim()) return;
    try {
      await api('/api/collections', { method: 'POST', body: { name: name.trim(), emoji: '📁' } });
      await loadAllData();
      toast('✓ Collection created');
    } catch (e) { toast(e.message, true); }
  });

  app.querySelectorAll('[data-plat]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.filters.fav = '';
      state.filters.pending = '';
      state.filters.platform = btn.dataset.plat;
      loadItems();
    });
  });

  app.querySelector('#flt-collection')?.addEventListener('change', (e) => { state.filters.collection = e.target.value; loadItems(); });
  app.querySelector('#flt-category')?.addEventListener('change', (e) => { state.filters.category = e.target.value; loadItems(); });
  app.querySelector('#flt-sort')?.addEventListener('change', (e) => { state.filters.sort = e.target.value; loadItems(); });

  const searchInput = app.querySelector('#global-search');
  searchInput?.addEventListener('input', (e) => {
    state.filters.q = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      if (state.view === 'vault') {
        const pos = e.target.selectionStart;
        await loadItems();
        const el = document.getElementById('global-search');
        if (el) { el.focus(); el.setSelectionRange(pos, pos); }
      }
    }, 220);
  });

  app.querySelectorAll('[data-layout]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.layout = btn.dataset.layout;
      localStorage.setItem('vault_layout', state.layout);
      renderApp();
    });
  });

  app.querySelector('#btn-theme')?.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('vault_theme', state.theme);
    document.documentElement.setAttribute('data-theme', state.theme);
    renderApp();
  });

  app.querySelector('#btn-logout')?.addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    state.user = null;
    authMode = 'login';
    renderAuth();
  });

  // Hover video preview on cards
  app.querySelectorAll('.vcard').forEach(card => {
    const vid = card.querySelector('video[data-hover-video]');
    if (vid) {
      card.addEventListener('mouseenter', () => { vid.play().catch(() => {}); });
      card.addEventListener('mouseleave', () => { vid.pause(); vid.currentTime = 0; });
    }
  });

  app.querySelectorAll('[data-open-item]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('button, a')) return;
      openItemDetail(Number(el.dataset.openItem));
    });
  });

  app.querySelectorAll('[data-upvote]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api(`/api/items/${btn.dataset.upvote}/upvote`, { method: 'POST' });
      loadItems();
    });
  });

  app.querySelectorAll('[data-fav]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api(`/api/items/${btn.dataset.fav}/favorite`, { method: 'POST' });
      loadAllData();
    });
  });

  app.querySelectorAll('[data-copy-prompt]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = state.prompts[Number(btn.dataset.copyPrompt)];
      if (p) copyText(p.content, 'Prompt copied');
    });
  });

  app.querySelectorAll('[data-copy-text]').forEach(btn => {
    btn.addEventListener('click', () => copyText(btn.dataset.copyText));
  });
}

function handleHashRoute() {
  if (!state.user) return;
  const h = location.hash || '';
  if (h.startsWith('#/add')) {
    const q = new URLSearchParams(h.split('?')[1] || '');
    const u = document.getElementById('qc-url');
    const p = document.getElementById('qc-prompt');
    if (u && q.get('url')) u.value = q.get('url');
    if (p && q.get('note')) p.value = q.get('note');
  } else if (h.startsWith('#/item/')) {
    const id = parseInt(h.replace('#/item/', ''), 10);
    if (id) openItemDetail(id);
  }
}

function setupGlobalShortcuts() {
  window.addEventListener('keydown', (e) => {
    const tag = (e.target?.tagName || '').toLowerCase();
    const inInput = ['input', 'textarea', 'select'].includes(tag) || e.target?.isContentEditable;
    if (e.key === 'Escape') {
      const modalRoot = document.getElementById('modal-root');
      if (modalRoot && modalRoot.innerHTML) {
        state.activeItem = null;
        modalRoot.innerHTML = '';
      }
      return;
    }
    if (inInput) return;
    if (e.key === '/') {
      e.preventDefault();
      document.getElementById('global-search')?.focus();
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      document.getElementById('qc-url')?.focus();
    }
  });
}

init();
