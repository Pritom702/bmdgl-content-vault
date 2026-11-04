import {
  PLATFORMS, CONTENT_TYPES, CATEGORIES, STATUSES, RESOURCE_STATUSES, RESOURCE_KINDS,
  analyzeUrl, extractUrl,
} from './platforms.js';

const TEAM_CREDENTIALS = [
  { name: 'Pritom',   email: 'pritom@brightmind.com',   password: 'password123' },
  { name: 'Sharafat', email: 'sharafat@brightmind.com', password: 'password123' },
  { name: 'Minhaj',   email: 'minhaj@brightmind.com',   password: 'password123' },
  { name: 'Saiful',   email: 'saiful@brightmind.com',   password: 'password123' },
  { name: 'Rafi',     email: 'rafi@brightmind.com',     password: 'password123' },
  { name: 'Tanvir',   email: 'tanvir@brightmind.com',   password: 'password123' },
  { name: 'Akib',     email: 'akib@brightmind.com',     password: 'password123' },
];

const state = {
  boot: null,
  user: null,
  view: 'vault', // 'vault' | 'resources' | 'profile' | 'team'
  layout: localStorage.getItem('vault_layout') || 'grid',
  theme: localStorage.getItem('vault_theme') || 'dark',
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
  activeTab: 'overview', // 'overview' | 'edit'
  showAddResource: false,
  stageMode: 'auto', // 'auto' | 'offline' | 'embed'
  resources: [],
  profileItems: [],
  suggestionsData: { keywords: [], categories: [], items: [], resources: [] },
  team: { members: [], inviteCode: null },
  agentData: null,
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

  const kwOnly = txt.match(/^(?:comment\s+)?["']?([A-Za-z0-9_-]{2,18})["']?$/i);
  if (kwOnly && !url) {
    return { resources: [], comment_keyword: kwOnly[1].toUpperCase(), notes: '' };
  }

  let kind = 'prompt';
  let title = 'Shared Prompt / Instructions';
  if (url) {
    if (/docs\.google\.com\/document/i.test(url)) { kind = 'prompt'; title = rest || 'Google Doc Prompt'; }
    else if (/drive\.google\.com|docs\.google\.com/i.test(url)) { kind = 'drive'; title = rest || 'Google Drive Folder / Doc'; }
    else if (/skool\.com/i.test(url)) { kind = 'skool'; title = rest || 'Skool Community Resource'; }
    else if (/github\.com/i.test(url)) {
      kind = 'tool';
      try {
        const u = new URL(url);
        const parts = u.pathname.split('/').filter(Boolean);
        title = rest.slice(0, 80) || (parts.length >= 2 ? `${parts[1]} (GitHub)` : 'GitHub Repository');
      } catch {
        title = rest.slice(0, 80) || 'GitHub Repository';
      }
    } else {
      kind = 'tool';
      title = rest.slice(0, 80) || 'Tool / Resource Link';
    }
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

function getActiveCategories() {
  return (state.stats?.allCategories && state.stats.allCategories.length)
    ? state.stats.allCategories
    : CATEGORIES;
}

async function loadAllData() {
  const [stats, colls, tags, sug] = await Promise.all([
    api('/api/stats'),
    api('/api/collections'),
    api('/api/tags'),
    api('/api/search-suggestions'),
  ]);
  state.stats = stats;
  state.collections = colls.collections || [];
  state.tags = tags.tags || [];
  state.suggestionsData = sug || { keywords: [], categories: [], items: [], resources: [] };
  if (state.view === 'resources') {
    state.resources = (await api('/api/library/resources')).resources || [];
  } else if (state.view === 'profile') {
    state.profileItems = (await api('/api/items?fav=1')).items || [];
  } else if (state.view === 'team' && state.user?.role === 'admin') {
    state.team = await api('/api/team');
  } else if (state.view === 'agent' && state.user?.role === 'admin') {
    state.agentData = await api('/api/agent/insights');
  }
  await loadItems();
  scheduleBackgroundPoll();
}

async function loadItems(preserveHeader = false) {
  state.loading = true;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(state.filters)) {
    if (v !== '' && v != null) params.set(k, v);
  }
  const res = await api(`/api/items?${params.toString()}`);
  state.items = res.items || [];
  state.total = res.total || 0;
  state.loading = false;
  if (preserveHeader) {
    const mainEl = document.getElementById('page-main');
    if (mainEl) {
      mainEl.innerHTML = renderMainView();
      bindMainEvents();
      return;
    }
  }
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

// ---------- Auth Screen (Copy-Pastable Team Credentials + Show Password + Forgot Password Request to Pritom) ----------
let authMode = 'login'; // 'login' | 'forgot' | 'register'
let forgotSentInfo = null; // { name, email, message }

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
            <div class="sub">Internal Team Repository · Persistent Login</div>
          </div>
        </div>

        ${authMode === 'login' ? `
          <form id="auth-form">
            <div class="field">
              <label>Email Address</label>
              <input name="email" id="auth-email" type="email" required placeholder="name@brightmind.com">
            </div>
            <div class="field">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <label>Password</label>
                <a href="#" id="link-forgot-pw" style="font-size:12px;font-weight:600">Forgot password?</a>
              </div>
              <div class="pw-wrap">
                <input name="password" id="auth-pass" type="password" required placeholder="••••••••">
                <button type="button" class="pw-toggle-btn" data-toggle-pw="auth-pass">Show</button>
              </div>
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%;padding:11px;margin-top:4px">
              Sign In →
            </button>
          </form>

          <div class="cred-box">
            <div class="cred-box-head">
              <span>Team Credentials (Copy &amp; Paste)</span>
            </div>
            <div class="cred-pw-row">
              <span style="color:var(--mute)">Default Password: <strong style="font-family:var(--font-mono);color:var(--ink);user-select:all">password123</strong></span>
              <button type="button" class="cred-copy-btn" data-copy-cred="password123">Copy Password</button>
            </div>
            <div class="cred-list">
              ${TEAM_CREDENTIALS.map(u => `
                <div class="cred-row">
                  <span class="cred-name">${esc(u.name)}</span>
                  <span class="cred-email">${esc(u.email)}</span>
                  <button type="button" class="cred-copy-btn" data-copy-cred="${esc(u.email)}">Copy Email</button>
                </div>
              `).join('')}
            </div>
          </div>
        ` : authMode === 'forgot' ? `
          <div style="margin-bottom:14px;font-size:13px;color:var(--ink-2);line-height:1.5">
            Enter your team email below to request a new password. Your request will be sent directly to <strong>Pritom</strong>, and he will provide you with a new password.
          </div>

          ${forgotSentInfo ? `
            <div class="info-box" style="border-color:var(--accent);background:var(--accent-soft);margin-bottom:14px">
              <div style="font-weight:700;color:var(--accent);margin-bottom:4px">✓ Request Sent to Pritom</div>
              <div style="font-size:12.5px;color:var(--ink);line-height:1.5">
                Password reset requested for <strong>${esc(forgotSentInfo.email)}</strong>. Pritom will set a new password in his Admin dashboard and provide it to you.
              </div>
            </div>
          ` : ''}

          <form id="forgot-form">
            <div class="field">
              <label>Your Team Email</label>
              <input name="email" type="email" required placeholder="e.g. minhaj@brightmind.com" value="${esc(forgotSentInfo?.email || '')}">
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%;padding:11px;margin-top:4px">
              Request New Password →
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
              <div class="pw-wrap">
                <input name="password" id="reg-pass" type="password" required minlength="8" placeholder="At least 8 characters">
                <button type="button" class="pw-toggle-btn" data-toggle-pw="reg-pass">Show</button>
              </div>
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

  app.querySelectorAll('[data-toggle-pw]').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = document.getElementById(btn.dataset.togglePw);
      if (!inp) return;
      const isPw = inp.type === 'password';
      inp.type = isPw ? 'text' : 'password';
      btn.textContent = isPw ? 'Hide' : 'Show';
      inp.focus();
    });
  });

  app.querySelectorAll('[data-copy-cred]').forEach(btn => {
    btn.addEventListener('click', () => {
      copyText(btn.dataset.copyCred, `Copied: ${btn.dataset.copyCred}`);
    });
  });

  app.querySelector('#link-forgot-pw')?.addEventListener('click', (e) => {
    e.preventDefault();
    forgotSentInfo = null;
    authMode = 'forgot';
    renderAuth();
  });

  app.querySelector('#btn-back-login')?.addEventListener('click', () => {
    forgotSentInfo = null;
    authMode = 'login';
    renderAuth();
  });

  app.querySelector('#forgot-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const res = await api('/api/auth/forgot-password', { method: 'POST', body: Object.fromEntries(fd.entries()) });
      forgotSentInfo = res;
      toast('✓ Password request sent to Pritom!');
      renderAuth();
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

// ---------- Main Application Render ----------
function renderApp() {
  if (!state.user) return renderAuth();
  const app = document.getElementById('app');
  const s = state.stats || { total: 0, favorites: 0, pending: 0, testing: 0, used: 0, prompts: 0, resources: 0 };
  const f = state.filters;
  const isAdmin = state.user.role === 'admin';

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
              Feed <span class="pill-count">${s.total}</span>
            </button>
            <button type="button" class="top-nav-btn ${state.view === 'resources' ? 'active' : ''}" data-view="resources">
              Prompts, Tools &amp; Links <span class="pill-count">${s.resources ?? s.prompts ?? 0}</span>
            </button>
            ${isAdmin ? `
              <button type="button" class="top-nav-btn ${state.view === 'agent' ? 'active' : ''}" data-view="agent">
                ✦ AI Agent
                <span class="pill-count" style="color:var(--accent)">● Live</span>
              </button>
              <button type="button" class="top-nav-btn ${state.view === 'team' ? 'active' : ''}" data-view="team">
                Team (${TEAM_CREDENTIALS.length})
                ${s.pendingPasswordResets ? `<span class="user-star-count" style="margin-left:4px">🔔 ${s.pendingPasswordResets}</span>` : ''}
              </button>
            ` : ''}
          </nav>

          <div class="search-box" id="search-box-wrap">
            <span class="s-icon">⌕</span>
            <input id="global-search" type="search" value="${esc(f.q)}" placeholder="Search keywords, reels, prompts, tools…" autocomplete="off">
            ${f.q ? `<button type="button" class="search-clear-btn" id="btn-clear-search" title="Clear search">✕</button>` : `<kbd>/</kbd>`}
            <div id="search-suggestions" class="search-suggestions" hidden></div>
          </div>

          <div class="header-right">
            <button class="icon-btn ${state.layout === 'grid' ? 'active' : ''}" data-layout="grid" title="Grid view">⊞</button>
            <button class="icon-btn ${state.layout === 'list' ? 'active' : ''}" data-layout="list" title="Compact list">☰</button>
            <button class="icon-btn" id="btn-theme" title="Toggle Dark / Light mode">${state.theme === 'dark' ? '☀' : '☾'}</button>
            <button type="button" class="user-pill-btn ${state.view === 'profile' ? 'active' : ''}" data-view="profile" title="Open your Profile & Star-Marked Saved Contents">
              <span class="avatar" style="background:#10B981">${esc(initials(state.user.name))}</span>
              <span>${esc(state.user.name.replace(/\s*\(Admin\)/i, ''))}</span>
              <span class="user-star-count" id="header-star-count">★ ${s.favorites || 0}</span>
            </button>
            <button class="icon-btn" id="btn-logout" title="Sign out">↪</button>
          </div>
        </div>
      </header>

      <main class="page-container" id="page-main">
        ${renderMainView()}
      </main>
    </div>
  `;

  bindShellEvents();
  bindMainEvents();
}

function renderMainView() {
  if (state.view === 'resources') return renderResourcesView();
  if (state.view === 'profile') return renderProfileView();
  if (state.view === 'agent' && state.user?.role === 'admin') return renderAgentView();
  if (state.view === 'team' && state.user?.role === 'admin') return renderTeamView();
  return renderVaultView();
}

// ---------- Frictionless 2-Box Quick Drop + Categorized Vault Feed ----------
function renderVaultView() {
  const f = state.filters;
  const activeFiltersCount = ['platform', 'category', 'type', 'status', 'resource', 'tag', 'fav', 'pending', 'collection', 'sharer', 'q']
    .filter(k => f[k]).length;

  const byCatMap = {};
  for (const row of (state.stats?.byCategory || [])) {
    byCatMap[row.category || row.k] = row.n;
  }
  const activeCats = getActiveCategories();
  const isAdmin = state.user?.role === 'admin';
  const agentInsights = state.stats?.agentInsights;
  const topRec = agentInsights?.recommendations?.[0];

  return `
    ${isAdmin && agentInsights ? `
      <div class="agent-advisor-banner">
        <div class="aab-left">
          <div class="aab-head">
            <span class="aab-badge">✦ Gemini AI Agent · Active</span>
            <span style="font-size:12px;color:var(--mute)">Auto-Creates Categories · Writes Perfect Titles &amp; Descriptions · Learns Your Preferences</span>
          </div>
          <div class="aab-text">
            <strong>Pritom Upgrade Tip:</strong> ${esc(topRec ? `${topRec.title} — ${topRec.action}` : agentInsights.summary)}
          </div>
        </div>
        <div class="aab-actions">
          <button type="button" class="btn btn-sm btn-primary" data-open-agent-view="1">Open AI Agent Advisor →</button>
        </div>
      </div>
    ` : ''}

    <form class="quick-composer" id="instant-drop-form">
      <div class="qc-top">
        <div class="qc-title">
          <span>Quick Drop to Vault</span>
          <span class="qc-badge">✦ Gemini AI Agent Auto-Categorizes &amp; Writes Title + Description</span>
        </div>
        <button type="button" class="btn btn-sm" id="btn-open-upload">📎 Upload File</button>
      </div>
      <div class="qc-grid">
        <input class="qc-input" id="qc-url" placeholder="1. Paste Reel / Post / YouTube / TikTok / Skool link…" autocomplete="off">
        <input class="qc-input" id="qc-prompt" placeholder="2. Paste Prompt, Google Doc / GitHub / Drive link, or Keyword…" autocomplete="off">
        <button type="submit" class="qc-submit" id="qc-submit-btn">Save to Vault →</button>
      </div>
      <div class="qc-foot">
        <span id="qc-live-hint">Paste the content link and the prompt/tool link — the Gemini AI Agent identifies the exact category (or creates a new category if needed) and writes a clean, accurate title and description.</span>
      </div>
    </form>

    <div class="filter-bar">
      <!-- Category Filter Row -->
      <div class="filter-row">
        <div class="filter-chips">
          <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--mute);margin-right:4px">Categories:</span>
          <button class="chip cat-chip ${!f.category ? 'active' : ''}" data-cat="">All (${state.stats?.total || 0})</button>
          ${activeCats.filter(c => c !== 'Other' || byCatMap[c]).map(c => {
            const count = byCatMap[c] || 0;
            return `<button class="chip cat-chip ${f.category === c ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}${count ? ` (${count})` : ''}</button>`;
          }).join('')}
        </div>
      </div>

      <!-- Platform & Sort Row -->
      <div class="filter-row">
        <div class="filter-chips">
          <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--mute);margin-right:4px">Platform:</span>
          <button class="chip ${!f.platform && !f.fav ? 'active' : ''}" data-plat="">All Platforms</button>
          <button class="chip ${f.fav === '1' ? 'active' : ''}" data-nav="fav">★ Starred</button>
          ${['facebook', 'instagram', 'youtube', 'tiktok', 'skool', 'drive'].map(p => {
            const info = PLATFORMS[p];
            return `<button class="chip ${f.platform === p ? 'active' : ''}" data-plat="${p}">${esc(info.label)}</button>`;
          }).join('')}
        </div>

        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
          <select class="filter-select" id="flt-sort">
            <option value="newest" ${f.sort === 'newest' ? 'selected' : ''}>Newest First</option>
            <option value="top" ${f.sort === 'top' ? 'selected' : ''}>Most Upvoted</option>
          </select>

          ${activeFiltersCount ? `<button class="btn btn-sm" id="btn-clear-filters">✕ Reset Filters (${activeFiltersCount})</button>` : ''}
        </div>
      </div>
    </div>

    ${state.items.length === 0 ? `
      <div class="empty-state">
        <h3>No content in this filter</h3>
        <p style="color:var(--mute)">Paste a Reel, YouTube video, or tool link in the Quick Drop bar above, or reset your filters.</p>
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
  const desc = item.summary || 'Fetching description…';
  const usage = item.what_it_does || '';
  const res = item.primary_resource;

  return `
    <article class="vcard" data-open-item="${item.id}">
      <div class="vcard-media">
        ${hasPlayableVideo ? `
          <video src="${esc(item.media_url)}" ${item.thumb ? `poster="${esc(item.thumb)}"` : ''} preload="metadata" muted loop playsinline data-hover-video="1"></video>
        ` : item.thumb ? `
          <img src="${esc(item.thumb)}" alt="${esc(item.title)}" loading="lazy">
        ` : `
          <div class="vcard-fallback">
            <div class="vf-hook">${esc(item.title)}</div>
          </div>
        `}
        <div class="vcard-badges-top">
          <span class="platform-pill">${esc(plat.label)}</span>
          <span class="type-pill">${esc(ctype)}</span>
        </div>
        <div class="play-overlay" title="Click to watch video & view details">▶</div>
        <div class="vcard-badges-bottom">
          ${hasPlayableVideo ? `<span class="offline-badge">● HD Video Ready</span>` : (item.platform === 'youtube' ? `<span class="offline-badge">● YouTube Player Ready</span>` : (item.archive_status === 'processing' ? `<span class="type-pill">Downloading video…</span>` : `<span></span>`))}
        </div>
      </div>

      <div class="vcard-body">
        <div class="vcard-meta-row">
          <span class="cat-badge">${esc(item.category)}</span>
          <span class="status-dot status-${esc(item.status)}">${esc(STATUSES[item.status] || item.status)}</span>
        </div>

        <h3 class="vcard-title">${esc(item.title || 'Shared Content')}</h3>

        <p class="vcard-desc">${esc(desc)}</p>

        ${usage && usage !== desc ? `
          <p class="vcard-usage"><strong>How to use it:</strong> ${esc(usage)}</p>
        ` : ''}

        ${res ? `
          <div class="vcard-resource-bar">
            <div class="vcard-resource-info">
              <span class="vcard-resource-label">${esc(RESOURCE_KINDS[res.kind] || 'Attached Resource')}</span>
              <span class="vcard-resource-title">${esc(res.title || res.url || 'Attached Resource')}</span>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0">
              ${(res.kind === 'prompt' && res.content) ? `<button type="button" class="btn btn-sm" data-copy-text="${esc(res.content)}">Copy Prompt</button>` : (!res.url && res.content ? `<button type="button" class="btn btn-sm" data-copy-text="${esc(res.content)}">Copy</button>` : '')}
              ${res.url ? `<a href="${esc(res.url)}" target="_blank" rel="noopener" class="btn btn-sm btn-primary" title="Open link">↗ Open</a>` : ''}
            </div>
          </div>
        ` : ''}

        ${item.comment_keyword ? `
          <div class="kw-banner ${item.resource_status === 'received' ? 'done' : ''}">
            <span>Comment "${esc(item.comment_keyword)}"</span>
            <span style="margin-left:auto">${item.resource_status === 'received' ? '✓ Resource Linked' : 'Keyword Trigger'}</span>
          </div>
        ` : ''}

        <div class="vcard-foot">
          <span>
            ${item.shared_by ? esc(item.shared_by.name) : 'Team'} · ${relTime(item.created_at)}
          </span>
          <div class="vcard-actions">
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
  const desc = item.summary || item.what_it_does || '';
  return `
    <div class="vrow" data-open-item="${item.id}">
      ${item.thumb ? `<img class="vrow-thumb" src="${esc(item.thumb)}" alt="">` : `<div class="vrow-thumb" style="display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700">▶</div>`}
      <div style="flex:1;min-width:0">
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:3px">
          <span class="type-pill" style="padding:2px 8px">${esc(plat.label)}</span>
          <span class="cat-badge">${esc(item.category)}</span>
        </div>
        <div style="font-weight:700;font-size:14.5px">${esc(item.title)}</div>
        <div style="font-size:12.5px;color:var(--ink-2)">${esc(desc)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <button type="button" class="act-btn ${item.upvoted ? 'active-up' : ''}" data-upvote="${item.id}">▲ ${item.upvotes || 0}</button>
        <button type="button" class="act-btn ${item.favorite ? 'active-fav' : ''}" data-fav="${item.id}">${item.favorite ? '★' : '☆'}</button>
      </div>
    </div>
  `;
}

// ---------- Merged Prompts, Tools & Links View ----------
function renderResourcesView() {
  return `
    <div style="margin-bottom:20px">
      <h2 style="margin:0;font-size:20px;font-weight:700">Prompts, Tools &amp; Links (${state.resources.length})</h2>
      <p style="margin:4px 0 0;color:var(--mute)">All prompts, GitHub repositories, Google Docs, and tools in one place — with links, title, and a short description.</p>
    </div>
    ${state.resources.length === 0 ? `
      <div class="empty-state">
        <h3>No prompts, tools, or links saved yet</h3>
        <p style="color:var(--mute)">Paste a link or prompt in the Quick Drop bar on the Feed to add one.</p>
      </div>
    ` : `
      <div class="vault-grid">
        ${state.resources.map((r, idx) => `
          <div class="lib-card">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
              <span class="cat-badge">${esc(r.category || RESOURCE_KINDS[r.kind] || 'Resource')}</span>
              <span class="type-pill" style="padding:2px 8px">${esc(RESOURCE_KINDS[r.kind] || r.kind || 'Link')}</span>
            </div>

            <h3 style="margin:0;font-size:16px;font-weight:700;line-height:1.38;color:var(--ink)">${esc(r.title)}</h3>

            <p style="margin:0;font-size:13.5px;color:var(--ink-2);line-height:1.55">${esc(r.description)}</p>

            ${r.url ? `
              <div class="res-link-row" title="${esc(r.url)}">
                <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a>
              </div>
            ` : ''}

            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:auto;padding-top:10px;border-top:1px solid var(--border)">
              <button type="button" class="btn btn-sm" data-open-item="${r.item_id}">▶ Watch Video</button>
              <div style="display:flex;gap:6px">
                ${r.prompt_text ? `<button type="button" class="btn btn-sm" data-copy-res="${idx}">Copy Prompt</button>` : ''}
                ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener" class="btn btn-sm btn-primary">↗ Open Link</a>` : ''}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;
}

// ---------- User Profile & Star-Marked Saved Contents ----------
function renderProfileView() {
  const s = state.stats || { favorites: 0, myShared: 0 };
  const cleanName = (state.user?.name || 'Member').replace(/\s*\(Admin\)/i, '');
  return `
    <div class="profile-header-card">
      <div style="display:flex;align-items:center;gap:16px">
        <span class="avatar" style="width:52px;height:52px;font-size:20px;border-radius:12px;background:#10B981">${esc(initials(cleanName))}</span>
        <div>
          <h2 style="margin:0;font-size:20px;font-weight:800">${esc(cleanName)}</h2>
          <div style="font-size:13px;color:var(--mute);margin-top:2px">${esc(state.user?.email || '')}</div>
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <div class="info-box" style="padding:10px 16px;text-align:center">
          <div style="font-size:18px;font-weight:800;color:var(--gold)">★ ${state.profileItems.length}</div>
          <div style="font-size:11px;font-weight:600;color:var(--mute);text-transform:uppercase">Star-Marked Saved</div>
        </div>
        <div class="info-box" style="padding:10px 16px;text-align:center">
          <div style="font-size:18px;font-weight:800;color:var(--accent)">${s.myShared || 0}</div>
          <div style="font-size:11px;font-weight:600;color:var(--mute);text-transform:uppercase">Shared by You</div>
        </div>
      </div>
    </div>

    <div style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between">
      <div>
        <h3 style="margin:0;font-size:18px;font-weight:700">★ Your Star-Marked Saved Contents (${state.profileItems.length})</h3>
        <p style="margin:4px 0 0;color:var(--mute);font-size:13px">Every video, reel, prompt, or tool you press the ★ Star button on is automatically saved to your account here.</p>
      </div>
    </div>

    ${state.profileItems.length === 0 ? `
      <div class="empty-state">
        <h3>No star-marked contents yet</h3>
        <p style="color:var(--mute)">Press the <strong>☆</strong> star button on any video or card in the Feed and it will automatically be saved to your profile.</p>
        <button type="button" class="btn btn-primary" data-nav="all">Browse Feed →</button>
      </div>
    ` : `
      <div class="vault-grid">
        ${state.profileItems.map(renderItemCard).join('')}
      </div>
    `}
  `;
}

// ---------- Gemini AI Agent & Pritom Upgrade Advisor View ----------
function renderAgentView() {
  const data = state.agentData || {};
  const insights = data.insights || state.stats?.agentInsights || {};
  const learned = Array.isArray(insights.learned_preferences) ? insights.learned_preferences : [];
  const recs = Array.isArray(insights.recommendations) ? insights.recommendations : [];
  const allCats = (data.allCategories || getActiveCategories()).filter(c => c !== 'Other');
  const customCats = Array.isArray(data.customCategories) ? data.customCategories : [];
  const modelName = data.model || insights.model || 'gemini-2.5-flash';

  return `
    <div class="agent-hero-card">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:16px">
        <div style="max-width:760px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap">
            <span class="aab-badge">✦ Autonomous Gemini AI Agent · Live (${esc(modelName)})</span>
            <span class="type-pill">Admin Advisor for Pritom</span>
            ${insights.created_at ? `<span style="font-size:12px;color:var(--mute)">Updated ${relTime(insights.created_at)}</span>` : ''}
          </div>
          <h2 style="margin:0 0 8px;font-size:21px;font-weight:800;color:var(--ink)">
            Pritom's Vault AI Agent &amp; Repository Upgrade Advisor
          </h2>
          <p style="margin:0;font-size:14px;color:var(--ink-2);line-height:1.6">
            ${esc(insights.summary || 'Your Gemini AI Agent is actively monitoring every shared reel, video, prompt, and tool — identifying or creating categories automatically, writing clean titles & descriptions, learning your preferences, and advising what to upgrade next.')}
          </p>
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn" id="btn-agent-reanalyze-all">↻ Re-Analyze All Items</button>
          <button type="button" class="btn btn-primary" id="btn-agent-refresh-insights">✦ Ask Agent for Fresh Upgrade Ideas</button>
        </div>
      </div>

      <div class="agent-cap-grid">
        <div class="agent-cap-box">
          <div class="agent-cap-title">1. Dynamic Category Creation</div>
          <div class="agent-cap-desc">Identifies the best category or automatically creates a brand-new category whenever novel content is shared.</div>
        </div>
        <div class="agent-cap-box">
          <div class="agent-cap-title">2. Perfect Title &amp; Description</div>
          <div class="agent-cap-desc">Generates accurate English titles, 1-2 sentence summaries, and clear "How to use it" guides with zero truncation.</div>
        </div>
        <div class="agent-cap-box">
          <div class="agent-cap-title">3. User Preference Learning</div>
          <div class="agent-cap-desc">Learns from your category edits, title refinements, star-marked favorites, and shared workflows.</div>
        </div>
        <div class="agent-cap-box">
          <div class="agent-cap-title">4. Proactive Repository Upgrades</div>
          <div class="agent-cap-desc">Periodically analyzes the Vault and tells Pritom what features, categories, or workflows we should upgrade next.</div>
        </div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:18px;margin-top:18px">
      <div class="lib-card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <h3 style="margin:0;font-size:17px;font-weight:700">🧠 Learned Preferences (Pritom &amp; Team)</h3>
          <span class="cat-badge">Memory Active</span>
        </div>
        <p style="margin:0;font-size:13px;color:var(--mute)">
          Every time you edit a title/category, star-mark content, or share a workflow, the Agent updates its learned rules:
        </p>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:6px">
          ${learned.map((pref, i) => `
            <div class="info-box" style="display:flex;gap:10px;align-items:flex-start;padding:11px 14px">
              <span style="color:var(--accent);font-weight:800;font-family:var(--font-mono)">0${i + 1}</span>
              <span style="font-size:13.5px;color:var(--ink);line-height:1.5">${esc(pref)}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="lib-card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <h3 style="margin:0;font-size:17px;font-weight:700">🏷️ Active &amp; Agent-Created Categories (${allCats.length})</h3>
          <span class="type-pill">Auto-Expanding</span>
        </div>
        <p style="margin:0;font-size:13px;color:var(--mute)">
          If shared content does not fit an existing category, the Gemini Agent invents and saves a new category automatically:
        </p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">
          ${allCats.map(cat => {
            const isCustom = customCats.some(x => x.name.toLowerCase() === cat.toLowerCase()) || !['AI Tools', 'Video Editing', 'Copywriting', 'Design', 'Marketing', 'Automation', 'Social Media', 'Coding', 'Business'].includes(cat);
            return `
              <button type="button" class="chip cat-chip" data-agent-filter-cat="${esc(cat)}" style="${isCustom ? 'border-color:var(--accent);color:var(--accent)' : ''}">
                ${isCustom ? '✦ ' : ''}${esc(cat)}
              </button>
            `;
          }).join('')}
        </div>
      </div>
    </div>

    <div style="margin-top:22px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div>
          <h3 style="margin:0;font-size:18px;font-weight:800">🚀 What We Should Upgrade Next in the Repository (For Pritom)</h3>
          <p style="margin:3px 0 0;font-size:13px;color:var(--mute)">Proactive upgrade recommendations generated by Gemini based on your repository contents and team activity.</p>
        </div>
      </div>

      <div class="vault-grid">
        ${recs.map(r => `
          <div class="lib-card" style="border-color:rgba(16,185,129,0.28)">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
              <span class="cat-badge">${esc(r.category || 'Repository Upgrade')}</span>
              <span style="font-size:11.5px;color:var(--accent);font-weight:700">✦ Agent Recommendation</span>
            </div>
            <h4 style="margin:4px 0 0;font-size:16px;font-weight:700;color:var(--ink);line-height:1.38">${esc(r.title)}</h4>
            <p style="margin:0;font-size:13.5px;color:var(--ink-2);line-height:1.55">
              <strong style="color:var(--ink)">Why it matters:</strong> ${esc(r.why)}
            </p>
            <div class="info-box" style="margin-top:auto;border-color:rgba(16,185,129,0.22);background:var(--accent-soft)">
              <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--accent);margin-bottom:3px">Recommended Next Step</div>
              <div style="font-size:13px;color:var(--ink);line-height:1.5">${esc(r.action)}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderTeamView() {
  const { members = [], inviteCode, resetRequests = [] } = state.team || {};
  const lastProvided = state.lastProvidedPassword; // { name, email, password }

  return `
    ${lastProvided ? `
      <div class="info-box" style="border-color:var(--accent);background:var(--accent-soft);margin-bottom:18px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <div style="font-weight:800;color:var(--accent);font-size:14px">
            ✓ New Password Set for ${esc(lastProvided.name.replace(/\s*\(Admin\)/i, ''))} (${esc(lastProvided.email)})
          </div>
          <div style="font-size:13px;color:var(--ink);margin-top:4px">
            New Password: <strong style="font-family:var(--font-mono);background:var(--bg);padding:3px 9px;border-radius:6px;user-select:all">${esc(lastProvided.password)}</strong>
            <span style="color:var(--ink-2);margin-left:8px">— Copy and send this to ${esc(lastProvided.name.replace(/\s*\(Admin\)/i, ''))}.</span>
          </div>
        </div>
        <button type="button" class="btn btn-primary btn-sm" data-copy-text="Email: ${esc(lastProvided.email)}&#10;New Password: ${esc(lastProvided.password)}">
          Copy Credentials for ${esc(lastProvided.name.replace(/\s*\(Admin\)/i, ''))}
        </button>
      </div>
    ` : ''}

    <div class="lib-card" style="margin-bottom:18px;border-color:${resetRequests.length ? 'var(--gold)' : 'var(--border)'}">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div>
          <h3 style="margin:0;font-size:17px;font-weight:700">
            🔔 Password Reset Requests (${resetRequests.length})
          </h3>
          <p style="margin:4px 0 0;font-size:13px;color:var(--mute)">
            When a teammate clicks "Forgot password?" and requests a new password, it appears here for you to set and provide to them.
          </p>
        </div>
      </div>

      ${resetRequests.length === 0 ? `
        <div class="info-box" style="color:var(--mute);font-size:13px">
          No pending password reset requests right now. You can also set a new password for any teammate below at any time.
        </div>
      ` : `
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:6px">
          ${resetRequests.map(req => `
            <form class="info-box" data-admin-reset-form="${req.user_id}" style="border-color:rgba(245,158,11,0.35);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
              <div>
                <div style="font-weight:700;font-size:14.5px;color:var(--ink)">
                  ${esc(req.name.replace(/\s*\(Admin\)/i, ''))}
                  <span class="user-star-count" style="margin-left:6px">Requested ${relTime(req.created_at)}</span>
                </div>
                <div style="font-family:var(--font-mono);font-size:12px;color:var(--ink-2);margin-top:2px">${esc(req.email)}</div>
              </div>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <div class="pw-wrap" style="width:230px">
                  <input name="newPassword" id="req-pw-${req.user_id}" type="text" required minlength="6" placeholder="Enter new password…" style="padding:7px 11px;border-radius:8px;border:1px solid var(--border-2);background:var(--bg);color:var(--ink);font-size:12.5px">
                  <button type="button" class="pw-toggle-btn" data-toggle-pw="req-pw-${req.user_id}">Hide</button>
                </div>
                <button type="submit" class="btn btn-primary btn-sm">Set &amp; Provide Password →</button>
              </div>
            </form>
          `).join('')}
        </div>
      `}
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:18px">
      <div class="lib-card">
        <h3 style="margin:0;font-size:17px;font-weight:700">BMDGL Team (${members.length})</h3>
        ${inviteCode ? `
          <div class="info-box" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
            <div>
              <div style="font-size:11px;font-weight:700;color:var(--mute);text-transform:uppercase">Team Invite Code</div>
              <div style="font-family:var(--font-mono);font-size:15px;font-weight:700;color:var(--accent)">${esc(inviteCode)}</div>
            </div>
            <button class="btn btn-sm btn-primary" data-copy-text="${esc(inviteCode)}">Copy</button>
          </div>
        ` : ''}
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
          ${members.map(m => {
            const cleanName = (m.name || '').replace(/\s*\(Admin\)/i, '');
            return `
              <form data-admin-reset-form="${m.id}" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:9px;background:var(--surface-2)">
                <div style="display:flex;align-items:center;gap:10px;min-width:180px">
                  <span class="avatar" style="background:#10B981">${esc(initials(cleanName))}</span>
                  <div>
                    <div style="font-weight:600">${esc(cleanName)}</div>
                    <div style="font-size:11.5px;color:var(--mute)">${esc(m.email)} · ${m.shared || 0} shared</div>
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:6px">
                  <input name="newPassword" type="text" required minlength="6" placeholder="New password…" style="width:145px;padding:5px 9px;border-radius:7px;border:1px solid var(--border-2);background:var(--bg);color:var(--ink);font-size:12px">
                  <button type="submit" class="btn btn-sm">Set Password</button>
                </div>
              </form>
            `;
          }).join('')}
        </div>
      </div>

      <div class="lib-card">
        <h3 style="margin:0;font-size:17px;font-weight:700">Export &amp; Backups</h3>
        <p style="margin:0;color:var(--mute);font-size:13px">Export the repository to CSV (Excel / Google Sheets) or download a full JSON backup.</p>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">
          <a href="/api/export.csv" class="btn btn-primary" style="justify-content:flex-start;padding:11px 14px">
            Export Repository to CSV (Excel / Sheets)
          </a>
          ${state.user.role === 'admin' ? `
            <a href="/api/export.json" class="btn" style="justify-content:flex-start;padding:11px 14px">
              Download Full JSON Backup
            </a>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

// ---------- Upload File Modal ----------
function openUploadModal() {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop" id="upload-backdrop">
      <div class="modal-dialog" style="max-width:500px">
        <div class="modal-head">
          <h3>Upload Video, Screenshot or File</h3>
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
          <button type="submit" class="btn btn-primary" id="btn-do-upload" style="width:100%;padding:11px">Upload &amp; Save →</button>
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
      toast('✓ Uploaded & saved!');
      await loadAllData();
      openItemDetail(res.item.id);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Upload & Save →';
      toast(err.message, true);
    }
  });
}

// ---------- Item Detail Theater Modal ----------
async function openItemDetail(id) {
  try {
    const res = await api(`/api/items/${id}`);
    state.activeItem = res.item;
    state.activeTab = 'overview';
    state.showAddResource = false;
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
        ${item.thumb ? `<img src="${esc(item.thumb)}" alt="" style="max-height:240px;border-radius:10px;margin-bottom:14px">` : `<div style="font-size:34px;margin-bottom:8px">▶</div>`}
        <div style="font-weight:700;font-size:15px;margin-bottom:6px">${esc(item.title)}</div>
        <p style="color:var(--mute);font-size:12.5px;margin-bottom:14px">
          ${item.archive_status === 'processing' ? 'Downloading HD video into the Vault right now — it will start playing automatically in a few seconds…' : 'Open the original link or click below to pull the HD video into the player.'}
        </p>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
          ${item.canonical_url ? `<a href="${esc(item.canonical_url)}" target="_blank" rel="noopener" class="btn btn-primary">↗ Open Original</a>` : ''}
          ${state.boot?.features?.archive && item.canonical_url && item.archive_status !== 'processing' ? `<button class="btn" id="btn-stage-archive">↓ Fetch HD Video</button>` : ''}
        </div>
      </div>
    `;
  }

  return `
    <div class="detail-stage">
      <div class="stage-toolbar">
        <div class="stage-modes">
          ${hasOffline ? `<button type="button" class="${mode === 'offline' ? 'active' : ''}" data-stage-mode="offline">▶ HD Video Player</button>` : ''}
          ${hasEmbed ? `<button type="button" class="${mode === 'embed' ? 'active' : ''}" data-stage-mode="embed">Platform Embed</button>` : ''}
        </div>
        <div>
          ${!hasOffline && state.boot?.features?.archive && item.canonical_url ? `
            <button type="button" class="btn btn-sm" id="btn-stage-archive">
              ${item.archive_status === 'processing' ? 'Downloading…' : '↓ Fetch HD Video'}
            </button>
          ` : ''}
        </div>
      </div>
      <div class="stage-viewport">
        ${viewportHtml}
      </div>
      <div class="stage-foot">
        <span>${esc(PLATFORMS[item.platform]?.label || item.platform)} · ${esc(CONTENT_TYPES[item.content_type] || item.content_type)}${item.author_name ? ` · ${esc(item.author_name)}` : ''}</span>
        ${item.canonical_url ? `<a href="${esc(item.canonical_url)}" target="_blank" rel="noopener">↗ Open Original Post</a>` : ''}
      </div>
    </div>
  `;
}

function renderModal() {
  const root = document.getElementById('modal-root');
  const item = state.activeItem;
  if (!item) { root.innerHTML = ''; return; }
  const ai = item.ai || {};
  const summaryText = item.summary || ai.summary || 'No description provided.';
  const usageText = item.what_it_does || ai.what_it_does || '';

  root.innerHTML = `
    <div class="modal-backdrop" id="detail-backdrop">
      <div class="modal-dialog xl">
        <div class="modal-head">
          <div style="display:flex;align-items:center;gap:10px;min-width:0">
            <span class="type-pill">${esc((PLATFORMS[item.platform] || PLATFORMS.web).label)}</span>
            <span class="cat-badge">${esc(item.category)}</span>
            <span style="font-size:12px;color:var(--mute)">Shared by ${esc(item.shared_by?.name || 'Team')} · ${relTime(item.created_at)}</span>
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
              <button type="button" class="${state.activeTab === 'overview' ? 'active' : ''}" data-dtab="overview">Overview &amp; Resources</button>
              <button type="button" class="${state.activeTab === 'edit' ? 'active' : ''}" data-dtab="edit">Edit Title, Category &amp; Description</button>
            </div>

            ${state.activeTab === 'overview' ? `
              <div>
                <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;line-height:1.35;color:var(--ink)">${esc(item.title)}</h2>
                <div class="info-box">
                  <h4>Description</h4>
                  <p style="margin:0;font-size:14px;line-height:1.6;color:var(--ink)">${esc(summaryText)}</p>
                  ${usageText && usageText !== summaryText ? `
                    <p style="margin:12px 0 0;padding-top:12px;border-top:1px solid var(--border);font-size:13.5px;line-height:1.55;color:var(--ink-2)">
                      <strong style="color:var(--ink)">How to use it:</strong> ${esc(usageText)}
                    </p>
                  ` : ''}
                </div>
              </div>

              ${item.comment_keyword ? `
                <div class="kw-banner ${item.resource_status === 'received' ? 'done' : ''}" style="padding:10px 14px;font-size:13px">
                  <span>Comment Keyword Trigger: <strong>"${esc(item.comment_keyword)}"</strong></span>
                  <select id="detail-res-status" class="filter-select" style="margin-left:auto;padding:4px 8px">
                    ${Object.entries(RESOURCE_STATUSES).map(([k, v]) => `<option value="${k}" ${item.resource_status === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
                  </select>
                </div>
              ` : ''}

              <div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                  <span style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--mute)">
                    Attached Prompt / Tool (${(item.resources_list || []).length})
                  </span>
                  <button type="button" class="btn btn-sm" id="btn-toggle-add-res">
                    ${state.showAddResource ? 'Cancel' : '＋ Add Prompt / Link'}
                  </button>
                </div>

                ${state.showAddResource ? `
                  <form id="add-res-form" class="info-box" style="margin-bottom:12px">
                    <h4>Add Prompt or Tool Link</h4>
                    <div class="field">
                      <input name="title" placeholder="Title (e.g. GitHub Repo / System Prompt)">
                    </div>
                    <div class="field">
                      <input name="url" placeholder="Tool / GitHub / Google Drive / Skool URL (https://…)">
                    </div>
                    <div class="field">
                      <textarea name="content" rows="3" placeholder="Or paste prompt text / instructions…"></textarea>
                    </div>
                    <button type="submit" class="btn btn-primary btn-sm">Save Resource</button>
                  </form>
                ` : ''}

                ${(item.resources_list || []).length === 0 ? `
                  <div class="info-box" style="color:var(--mute);font-size:13px">
                    No prompt or tool link attached yet. Click <strong>＋ Add Prompt / Link</strong> above to attach one.
                  </div>
                ` : (item.resources_list || []).map(r => `
                  <div class="info-box" style="margin-bottom:10px">
                    <h4>
                      <span><span class="cat-badge">${esc(RESOURCE_KINDS[r.kind] || r.kind)}</span> ${esc(r.title || 'Attached Resource')}</span>
                      <div style="display:flex;gap:6px">
                        ${r.content ? `<button class="btn btn-sm" data-copy-text="${esc(r.content)}">Copy Prompt / Text</button>` : ''}
                        ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener" class="btn btn-sm btn-primary">↗ Open Link</a>` : ''}
                        <button class="btn btn-sm btn-danger" data-del-res="${r.id}" title="Remove resource">✕</button>
                      </div>
                    </h4>
                    ${r.content ? `<div class="prompt-block">${esc(r.content)}</div>` : ''}
                    ${r.url ? `<div style="font-family:var(--font-mono);font-size:12px;margin-top:8px;word-break:break-all"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a></div>` : ''}
                  </div>
                `).join('')}
              </div>

              ${item.caption ? `
                <div class="info-box">
                  <h4>Original Caption / Video Notes</h4>
                  <div style="font-size:12.5px;color:var(--ink-2);white-space:pre-wrap;line-height:1.5;max-height:180px;overflow-y:auto">${esc(item.caption)}</div>
                </div>
              ` : ''}

              <div>
                <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--mute);margin-bottom:8px">
                  Team Notes (${(item.comments_list || []).length})
                </div>
                ${(item.comments_list || []).map(c => `
                  <div class="info-box" style="padding:10px 14px;margin-bottom:8px">
                    <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--mute);margin-bottom:4px">
                      <strong style="color:var(--ink)">${esc(c.name || 'Teammate')}</strong>
                      <span>${relTime(c.created_at)}</span>
                    </div>
                    <div style="white-space:pre-wrap;font-size:13px;color:var(--ink-2)">${esc(c.body)}</div>
                  </div>
                `).join('')}

                <form id="comment-form" style="display:flex;gap:8px;margin-top:6px">
                  <input name="body" required placeholder="Add a quick note for the team…" style="flex:1;padding:9px 13px;border-radius:9px;border:1px solid var(--border-2);background:var(--bg);color:var(--ink)">
                  <button type="submit" class="btn btn-primary">Post</button>
                </form>
              </div>
            ` : ''}

            ${state.activeTab === 'edit' ? `
              <form id="edit-item-form">
                <div class="field">
                  <label>Title</label>
                  <input name="title" value="${esc(item.title)}">
                </div>
                <div class="field">
                  <label>Category (Select existing or type a new category — Gemini Agent learns from your choice)</label>
                  <input name="category" list="vault-category-list" value="${esc(item.category)}" placeholder="Select or type a new category…">
                  <datalist id="vault-category-list">
                    ${getActiveCategories().map(c => `<option value="${esc(c)}"></option>`).join('')}
                  </datalist>
                </div>
                <div class="field">
                  <label>Small, Accurate Description</label>
                  <textarea name="summary" rows="3">${esc(item.summary || '')}</textarea>
                </div>
                <div class="field">
                  <label>How to Use It</label>
                  <textarea name="what_it_does" rows="2">${esc(item.what_it_does || '')}</textarea>
                </div>
                <div style="display:flex;justify-content:space-between;margin-top:14px">
                  <button type="button" class="btn btn-danger" id="btn-delete-item">Delete Item</button>
                  <div style="display:flex;gap:8px">
                    <button type="button" class="btn" id="btn-reanalyze">↻ Ask Gemini Agent to Regenerate</button>
                    <button type="submit" class="btn btn-primary">Save Changes</button>
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

  root.querySelector('#btn-toggle-add-res')?.addEventListener('click', () => {
    state.showAddResource = !state.showAddResource;
    renderModal();
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
    toast(res.favorite ? '★ Saved to your Profile!' : 'Removed from your Profile');
    renderModal();
    loadAllData();
  });

  root.querySelector('#btn-stage-archive')?.addEventListener('click', async () => {
    try {
      const res = await api(`/api/items/${item.id}/archive`, { method: 'POST' });
      state.activeItem = res.item;
      toast('Downloading HD video into Vault…');
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
      state.showAddResource = false;
      toast('✓ Resource saved');
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
    state.activeTab = 'overview';
    toast('✓ Changes saved');
    renderModal();
    loadAllData();
  });

  root.querySelector('#btn-reanalyze')?.addEventListener('click', async () => {
    try {
      const res = await api(`/api/items/${item.id}/reanalyze`, { method: 'POST' });
      state.activeItem = res.item;
      state.activeTab = 'overview';
      toast('Auto-generating title & description…');
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

// ---------- Live Search Keyword Suggestions ----------
function renderSearchSuggestions(rawQuery = '') {
  const box = document.getElementById('search-suggestions');
  if (!box) return;
  const q = rawQuery.trim().toLowerCase();
  const baseKeywords = state.suggestionsData?.keywords?.length
    ? state.suggestionsData.keywords
    : ['Claude', 'Motion Graphics', 'Documentary', 'AI Tools', 'YouTube Automation', 'AI Agent', 'GitHub Repository', 'Google Doc Prompt', '3D Animation', 'Agent Reach', 'YouTube Agent Skill'];

  const matchedKeywords = baseKeywords.filter(k => !q || k.toLowerCase().includes(q)).slice(0, 8);
  const matchedCats = getActiveCategories().filter(c => c !== 'Other' && (!q || c.toLowerCase().includes(q))).slice(0, 4);
  const allItems = state.suggestionsData?.items || state.items || [];
  const matchedItems = allItems
    .filter(it => !q || `${it.title || ''} ${it.category || ''} ${it.platform || ''}`.toLowerCase().includes(q))
    .slice(0, 4);

  if (!matchedKeywords.length && !matchedCats.length && !matchedItems.length) {
    box.innerHTML = `<div style="padding:8px 10px;font-size:12.5px;color:var(--mute)">Press Enter to search for "<strong>${esc(rawQuery)}</strong>"</div>`;
    box.hidden = false;
    return;
  }

  box.innerHTML = `
    ${matchedKeywords.length ? `
      <div class="sug-section">
        <div class="sug-head">Keyword Suggestions</div>
        <div class="sug-kw-wrap">
          ${matchedKeywords.map(kw => `
            <button type="button" class="sug-kw-pill" data-sug-kw="${esc(kw)}">
              <span style="color:var(--accent)">⌕</span> ${esc(kw)}
            </button>
          `).join('')}
        </div>
      </div>
    ` : ''}

    ${matchedCats.length ? `
      <div class="sug-section">
        <div class="sug-head">Categories</div>
        <div class="sug-kw-wrap">
          ${matchedCats.map(cat => `
            <button type="button" class="sug-kw-pill" data-sug-cat="${esc(cat)}">
              <span style="color:var(--accent)">▤</span> ${esc(cat)}
            </button>
          `).join('')}
        </div>
      </div>
    ` : ''}

    ${matchedItems.length ? `
      <div class="sug-section">
        <div class="sug-head">Matching Content</div>
        ${matchedItems.map(it => `
          <button type="button" class="sug-item-row" data-sug-item="${it.id}">
            <span style="font-weight:600;line-height:1.35">${esc(it.title)}</span>
            <span class="cat-badge" style="flex-shrink:0">${esc(it.category || 'Vault')}</span>
          </button>
        `).join('')}
      </div>
    ` : ''}
  `;
  box.hidden = false;

  box.querySelectorAll('[data-sug-kw]').forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const kw = btn.dataset.sugKw;
      state.filters.q = kw;
      state.filters.category = '';
      state.view = 'vault';
      box.hidden = true;
      loadItems();
    });
  });

  box.querySelectorAll('[data-sug-cat]').forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      state.filters.category = btn.dataset.sugCat;
      state.filters.q = '';
      state.view = 'vault';
      box.hidden = true;
      loadItems();
    });
  });

  box.querySelectorAll('[data-sug-item]').forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      box.hidden = true;
      openItemDetail(Number(btn.dataset.sugItem));
    });
  });
}

// ---------- Shell & Main Events ----------
let searchTimer = null;
function bindShellEvents() {
  const app = document.getElementById('app');

  app.querySelectorAll('.top-header [data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.view = 'vault';
      for (const k of Object.keys(state.filters)) if (k !== 'sort') state.filters[k] = '';
      loadItems();
    });
  });

  app.querySelectorAll('.top-header [data-view]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const v = btn.dataset.view;
      if ((v === 'team' || v === 'agent') && state.user?.role !== 'admin') return;
      state.view = v;
      if (v === 'resources') {
        state.resources = (await api('/api/library/resources')).resources || [];
      } else if (v === 'profile') {
        state.profileItems = (await api('/api/items?fav=1')).items || [];
      } else if (v === 'agent') {
        state.agentData = await api('/api/agent/insights');
      } else if (v === 'team') {
        state.team = await api('/api/team');
      }
      renderApp();
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
  });

  const searchInput = app.querySelector('#global-search');
  const sugBox = app.querySelector('#search-suggestions');

  searchInput?.addEventListener('focus', () => {
    renderSearchSuggestions(searchInput.value);
  });

  searchInput?.addEventListener('input', (e) => {
    const val = e.target.value;
    state.filters.q = val;
    renderSearchSuggestions(val);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      if (state.view !== 'vault') {
        state.view = 'vault';
      }
      await loadItems(true);
    }, 150);
  });

  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (sugBox) sugBox.hidden = true;
      state.view = 'vault';
      loadItems(true);
    } else if (e.key === 'Escape') {
      if (sugBox) sugBox.hidden = true;
      searchInput.blur();
    }
  });

  searchInput?.addEventListener('blur', () => {
    setTimeout(() => {
      const b = document.getElementById('search-suggestions');
      if (b) b.hidden = true;
    }, 160);
  });

  app.querySelector('#btn-clear-search')?.addEventListener('click', () => {
    state.filters.q = '';
    state.view = 'vault';
    loadItems();
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
}

function bindMainEvents() {
  const main = document.getElementById('page-main') || document.getElementById('app');
  if (!main) return;

  main.querySelector('#btn-open-upload')?.addEventListener('click', () => openUploadModal());

  const dropForm = main.querySelector('#instant-drop-form');
  const qcUrl = main.querySelector('#qc-url');
  const qcHint = main.querySelector('#qc-live-hint');

  qcUrl?.addEventListener('input', () => {
    const info = analyzeUrl(extractUrl(qcUrl.value) || qcUrl.value.trim());
    if (info && qcHint) {
      const plat = PLATFORMS[info.platform] || PLATFORMS.web;
      qcHint.innerHTML = `<span style="color:var(--accent);font-weight:600">✓ ${esc(plat.label)} ${esc(CONTENT_TYPES[info.contentType] || 'Link')} detected</span> — hit Enter or click Save to categorize and generate the description.`;
    }
  });

  dropForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawUrl = (main.querySelector('#qc-url')?.value || '').trim();
    const rawPrompt = (main.querySelector('#qc-prompt')?.value || '').trim();
    if (!rawUrl && !rawPrompt) {
      toast('Paste a Reel/video link or a prompt first!', true);
      return;
    }
    const btn = main.querySelector('#qc-submit-btn');
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
      toast('✓ Saved to Vault! Fetching metadata & description…');
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
  main.querySelector('#btn-clear-filters')?.addEventListener('click', resetFilters);
  main.querySelector('#btn-empty-reset')?.addEventListener('click', resetFilters);

  main.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.view = 'vault';
      for (const k of Object.keys(state.filters)) if (k !== 'sort' && k !== 'q') state.filters[k] = '';
      const nav = btn.dataset.nav;
      if (nav === 'fav') state.filters.fav = '1';
      else if (nav === 'pending') state.filters.pending = '1';
      loadItems();
    });
  });

  main.querySelectorAll('[data-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.filters.category = btn.dataset.cat;
      loadItems();
    });
  });

  main.querySelectorAll('[data-plat]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.filters.fav = '';
      state.filters.pending = '';
      state.filters.platform = btn.dataset.plat;
      loadItems();
    });
  });

  main.querySelector('#flt-sort')?.addEventListener('change', (e) => { state.filters.sort = e.target.value; loadItems(); });

  main.querySelectorAll('.vcard').forEach(card => {
    const vid = card.querySelector('video[data-hover-video]');
    if (vid) {
      card.addEventListener('mouseenter', () => { vid.play().catch(() => {}); });
      card.addEventListener('mouseleave', () => { vid.pause(); vid.currentTime = 0; });
    }
  });

  main.querySelectorAll('[data-open-item]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('button, a')) return;
      openItemDetail(Number(el.dataset.openItem));
    });
  });

  main.querySelectorAll('[data-upvote]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api(`/api/items/${btn.dataset.upvote}/upvote`, { method: 'POST' });
      loadItems();
    });
  });

  main.querySelectorAll('[data-fav]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const res = await api(`/api/items/${btn.dataset.fav}/favorite`, { method: 'POST' });
      toast(res.favorite ? '★ Saved to your Profile!' : 'Removed from your Profile');
      await loadAllData();
    });
  });

  main.querySelectorAll('[data-copy-res]').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = state.resources[Number(btn.dataset.copyRes)];
      if (r && r.prompt_text) copyText(r.prompt_text, 'Prompt copied to clipboard');
    });
  });

  main.querySelectorAll('[data-toggle-pw]').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = document.getElementById(btn.dataset.togglePw);
      if (!inp) return;
      const isPw = inp.type === 'password';
      inp.type = isPw ? 'text' : 'password';
      btn.textContent = isPw ? 'Hide' : 'Show';
      inp.focus();
    });
  });

  main.querySelectorAll('[data-admin-reset-form]').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const uid = form.dataset.adminResetForm;
      const newPassword = (form.newPassword?.value || '').trim();
      if (!newPassword || newPassword.length < 6) {
        toast('New password must be at least 6 characters.', true);
        return;
      }
      try {
        const res = await api(`/api/team/${uid}/reset-password`, {
          method: 'POST',
          body: { newPassword },
        });
        state.lastProvidedPassword = {
          name: res.user?.name || 'Teammate',
          email: res.user?.email || '',
          password: res.newPassword || newPassword,
        };
        toast(`✓ New password set for ${state.lastProvidedPassword.name.replace(/\s*\(Admin\)/i, '')}!`);
        await loadAllData();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  main.querySelectorAll('[data-copy-text]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyText(btn.dataset.copyText);
    });
  });

  main.querySelectorAll('[data-open-agent-view]').forEach(btn => {
    btn.addEventListener('click', async () => {
      state.view = 'agent';
      state.agentData = await api('/api/agent/insights');
      renderApp();
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
  });

  main.querySelectorAll('[data-agent-filter-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.filters.category = btn.dataset.agentFilterCat;
      state.view = 'vault';
      loadItems();
    });
  });

  main.querySelector('#btn-agent-refresh-insights')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '✦ Asking Gemini Agent…';
    try {
      state.agentData = await api('/api/agent/insights/refresh', { method: 'POST' });
      state.stats = await api('/api/stats');
      toast('✓ Gemini Agent generated fresh repository upgrade recommendations!');
      renderApp();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '✦ Ask Agent for Fresh Upgrade Ideas';
      toast(err.message, true);
    }
  });

  main.querySelector('#btn-agent-reanalyze-all')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '↻ Re-Analyzing…';
    try {
      const res = await api('/api/agent/reanalyze-all', { method: 'POST' });
      toast(`✓ Gemini Agent queued ${res.count} items for category & description analysis!`);
      await loadAllData();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '↻ Re-Analyze All Items';
      toast(err.message, true);
    }
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
