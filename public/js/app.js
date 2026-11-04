import {
  PLATFORMS, CONTENT_TYPES, CATEGORIES, STATUSES, RESOURCE_STATUSES, RESOURCE_KINDS,
  analyzeUrl, extractUrl,
} from './platforms.js';

const state = {
  boot: null,
  user: null,
  view: 'vault', // 'vault' | 'prompts' | 'hooks' | 'tools' | 'team'
  layout: localStorage.getItem('vault_layout') || 'grid',
  theme: localStorage.getItem('vault_theme') || 'light',
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
  setTimeout(() => el.remove(), 3600);
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
  const busy = state.items.some(i => i.ai_status === 'pending' || i.ai_status === 'processing')
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
    }, 3500);
  }
}

// ---------- Auth Screen ----------
let authMode = 'login';
function renderAuth() {
  const needsSetup = state.boot?.needsSetup;
  if (needsSetup) authMode = 'register';
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="auth-minimal">
      <div class="auth-card">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px">
          <img src="/logo.png" alt="Bright Mind" style="height:40px;background:#fff;padding:4px 8px;border-radius:8px;border:1px solid var(--border)">
          <div>
            <h2 style="margin:0;font-size:19px">BMDGL Content Vault</h2>
            <div style="font-size:12px;color:var(--mute);font-weight:600">Internal Team Portal · Authorized Access Only</div>
          </div>
        </div>
        ${!needsSetup ? `
          <div class="auth-tabs">
            <button type="button" class="${authMode === 'login' ? 'active' : ''}" data-auth-tab="login">Sign In</button>
            <button type="button" class="${authMode === 'register' ? 'active' : ''}" data-auth-tab="register">Join with Invite Code</button>
          </div>
        ` : ''}
        <form id="auth-form">
          ${authMode === 'register' ? `
            <div class="field">
              <label>Your Name</label>
              <input name="name" required placeholder="Full Name">
            </div>
          ` : ''}
          <div class="field">
            <label>Email Address</label>
            <input name="email" id="auth-email" type="email" required placeholder="you@brightmind.com">
          </div>
          <div class="field">
            <label>Password</label>
            <input name="password" id="auth-pass" type="password" required minlength="8" placeholder="••••••••">
          </div>
          ${authMode === 'register' && !needsSetup ? `
            <div class="field">
              <label>Team Invite Code</label>
              <input name="inviteCode" required placeholder="Enter team invite code">
            </div>
          ` : ''}
          <button type="submit" class="btn btn-primary" style="width:100%;padding:10px;margin-top:4px">
            ${authMode === 'register' ? 'Create Account →' : 'Sign In →'}
          </button>
        </form>
      </div>
    </div>
  `;

  app.querySelectorAll('[data-auth-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      authMode = btn.dataset.authTab;
      renderAuth();
    });
  });

  app.querySelector('#auth-form').addEventListener('submit', async (e) => {
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
  const s = state.stats || { total: 0, favorites: 0, pending: 0, testing: 0, used: 0, prompts: 0 };
  const f = state.filters;

  const isAllVault = state.view === 'vault' && !f.fav && !f.pending && !f.status && !f.collection && !f.category;

  app.innerHTML = `
    <div class="shell">
      <div class="sidebar-backdrop ${state.sidebarOpen ? 'open' : ''}" id="sb-backdrop"></div>
      <aside class="sidebar ${state.sidebarOpen ? 'open' : ''}">
        <div class="brand-box">
          <img src="/logo.png" alt="BMDGL">
          <div>
            <div class="b-title">BMDGL Vault</div>
            <div class="b-sub">Digital Growth Lab</div>
          </div>
        </div>

        <button class="btn-share-cta" id="btn-open-share">
          <span>＋ Share Content</span>
          <kbd>N</kbd>
        </button>

        <div class="nav-group-label">Views &amp; Workflow</div>
        <button class="nav-item ${isAllVault ? 'active' : ''}" data-nav="all">
          <span>🗂️ All Content</span>
          <span class="count">${s.total}</span>
        </button>
        <button class="nav-item ${state.view === 'vault' && f.fav === '1' ? 'active' : ''}" data-nav="fav">
          <span>⭐ Starred / Favorites</span>
          <span class="count">${s.favorites}</span>
        </button>
        <button class="nav-item ${state.view === 'vault' && f.pending === '1' ? 'active' : ''}" data-nav="pending">
          <span>💬 Need Comment / DM</span>
          <span class="count ${s.pending ? 'badge-warn' : ''}">${s.pending}</span>
        </button>
        <button class="nav-item ${state.view === 'vault' && f.status === 'testing' ? 'active' : ''}" data-nav="testing">
          <span>🧪 Testing in Lab</span>
          <span class="count">${s.testing}</span>
        </button>
        <button class="nav-item ${state.view === 'vault' && f.status === 'used' ? 'active' : ''}" data-nav="used">
          <span>✅ Used in Our Content</span>
          <span class="count">${s.used}</span>
        </button>

        <div class="nav-group-label">Specialized Libraries</div>
        <button class="nav-item ${state.view === 'prompts' ? 'active' : ''}" data-view="prompts">
          <span>✨ Prompt Library</span>
          <span class="count">${s.prompts}</span>
        </button>
        <button class="nav-item ${state.view === 'hooks' ? 'active' : ''}" data-view="hooks">
          <span>🎯 Hook &amp; Payoff Lab</span>
        </button>
        <button class="nav-item ${state.view === 'tools' ? 'active' : ''}" data-view="tools">
          <span>🧰 Tools &amp; Drive Links</span>
        </button>
        <button class="nav-item ${state.view === 'team' ? 'active' : ''}" data-view="team">
          <span>👥 Team &amp; Export</span>
        </button>

        <div class="nav-group-label">
          <span>Collections</span>
          <button type="button" id="btn-new-collection">＋ New</button>
        </div>
        ${state.collections.map(c => `
          <button class="nav-item ${state.view === 'vault' && String(f.collection) === String(c.id) ? 'active' : ''}" data-collection="${c.id}">
            <span>${esc(c.emoji || '📁')} ${esc(c.name)}</span>
            <span class="count">${c.n || 0}</span>
          </button>
        `).join('')}

        <div class="nav-group-label">Categories</div>
        ${(s.byCategory || []).map(c => `
          <button class="nav-item ${state.view === 'vault' && f.category === c.category ? 'active' : ''}" data-cat="${esc(c.category)}">
            <span>• ${esc(c.category)}</span>
            <span class="count">${c.n}</span>
          </button>
        `).join('')}

        <div class="sidebar-footer">
          <div class="user-row">
            <span class="avatar" style="background:${esc(state.user.color || '#1F6FE5')}">${esc(initials(state.user.name))}</span>
            <div class="user-info">
              <div class="u-name">${esc(state.user.name)}</div>
              <div class="u-role">${esc(state.user.role)}</div>
            </div>
            <button class="icon-btn" id="btn-logout" title="Sign out" style="padding:5px 8px">↪</button>
          </div>
        </div>
      </aside>

      <div class="main-area">
        <header class="topbar">
          <button class="mobile-menu-btn" id="btn-mobile-menu">☰</button>
          <div class="search-box">
            <span class="s-icon">🔍</span>
            <input id="global-search" type="search" value="${esc(f.q)}" placeholder="Search hooks, prompts, tools, Bangla text, tags…">
            <kbd>/</kbd>
          </div>

          <form class="quick-paste-bar" id="quick-paste-form">
            <input id="quick-paste-input" placeholder="Paste any FB / IG Reel, YouTube, TikTok, Skool or Drive link…">
            <button type="submit">Save + Analyze →</button>
          </form>

          <div class="topbar-actions">
            <button class="icon-btn ${state.layout === 'grid' ? 'active' : ''}" data-layout="grid" title="Grid view">⊞</button>
            <button class="icon-btn ${state.layout === 'list' ? 'active' : ''}" data-layout="list" title="Compact list view">☰</button>
            <button class="icon-btn" id="btn-theme" title="Toggle Dark/Light Mode">${state.theme === 'dark' ? '☀️' : '🌙'}</button>
          </div>
        </header>

        <main class="content-wrap">
          ${renderMainView()}
        </main>
      </div>
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

function renderVaultView() {
  const s = state.stats || {};
  const f = state.filters;
  const activeFiltersCount = ['platform', 'category', 'type', 'status', 'resource', 'tag', 'fav', 'pending', 'collection', 'sharer', 'q']
    .filter(k => f[k]).length;

  return `
    <div class="stats-strip">
      <div class="stat-tile" data-quick-filter="all">
        <div class="st-val">${s.total || 0}</div>
        <div class="st-lbl">Saved in Vault</div>
      </div>
      <div class="stat-tile" data-quick-filter="pending">
        <div class="st-val" style="color:${s.pending ? 'var(--amber)' : 'inherit'}">${s.pending || 0}</div>
        <div class="st-lbl">Need Comment / DM</div>
      </div>
      <div class="stat-tile" data-quick-filter="testing">
        <div class="st-val" style="color:var(--primary)">${s.testing || 0}</div>
        <div class="st-lbl">Testing in Content</div>
      </div>
      <div class="stat-tile" data-quick-filter="used">
        <div class="st-val" style="color:var(--green)">${s.used || 0}</div>
        <div class="st-lbl">Used in Production</div>
      </div>
      <div class="stat-tile" data-quick-view="prompts">
        <div class="st-val">${s.prompts || 0}</div>
        <div class="st-lbl">Saved Prompts</div>
      </div>
      <div class="stat-tile" data-quick-view="hooks">
        <div class="st-val">🎯</div>
        <div class="st-lbl">Hook &amp; Payoff Lab</div>
      </div>
    </div>

    <div class="filter-bar">
      <div class="filter-chips">
        <button class="chip ${!f.platform ? 'active' : ''}" data-plat="">All Platforms</button>
        ${['instagram', 'facebook', 'youtube', 'tiktok', 'skool', 'drive'].map(p => {
          const info = PLATFORMS[p];
          return `<button class="chip ${f.platform === p ? 'active' : ''}" data-plat="${p}">${esc(info.label)}</button>`;
        }).join('')}
      </div>

      <div style="margin-left:auto;display:flex;flex-wrap:wrap;gap:8px;align-items:center">
        <select class="filter-select" id="flt-type">
          <option value="">All Formats</option>
          ${Object.entries(CONTENT_TYPES).map(([k, v]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
        </select>

        <select class="filter-select" id="flt-category">
          <option value="">All Categories</option>
          ${CATEGORIES.map(c => `<option value="${esc(c)}" ${f.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>

        <select class="filter-select" id="flt-status">
          <option value="">All Workflow States</option>
          ${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
        </select>

        <select class="filter-select" id="flt-sort">
          <option value="newest" ${f.sort === 'newest' ? 'selected' : ''}>Newest First</option>
          <option value="useful" ${f.sort === 'useful' ? 'selected' : ''}>Highest Usefulness</option>
          <option value="top" ${f.sort === 'top' ? 'selected' : ''}>Most Upvoted</option>
          <option value="oldest" ${f.sort === 'oldest' ? 'selected' : ''}>Oldest First</option>
          <option value="title" ${f.sort === 'title' ? 'selected' : ''}>Title A–Z</option>
        </select>

        ${activeFiltersCount ? `<button class="btn btn-sm" id="btn-clear-filters">✕ Reset (${activeFiltersCount})</button>` : ''}
      </div>
    </div>

    ${state.items.length === 0 ? `
      <div class="empty-state">
        <div style="font-size:38px">📭</div>
        <h3>No matching content in this view</h3>
        <p>Share a Facebook/Instagram Reel, YouTube video, TikTok, Skool link, or upload a video/prompt to build your swipe file.</p>
        <div style="display:flex;gap:10px;justify-content:center">
          ${activeFiltersCount ? `<button class="btn" id="btn-empty-reset">Clear Filters</button>` : ''}
          <button class="btn btn-primary" id="btn-empty-share">＋ Share First Content</button>
        </div>
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
  const ctype = CONTENT_TYPES[item.content_type] || 'Item';
  const isPlayable = ['reel', 'short', 'video'].includes(item.content_type) || item.has_media;

  return `
    <article class="vcard" data-open-item="${item.id}">
      <div class="vcard-media">
        ${item.thumb ? `
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
        ${isPlayable ? `<div class="play-overlay" title="Watch directly in Vault">▶</div>` : ''}
        <div class="vcard-badges-bottom">
          ${item.has_media ? `<span class="offline-badge">✓ Instant In-App Video</span>` : `<span></span>`}
          ${item.usefulness ? `<span class="score-badge">★ ${item.usefulness}/10</span>` : ''}
        </div>
      </div>

      <div class="vcard-body">
        <div class="vcard-meta-row">
          <span class="cat-badge">${esc(item.category)}</span>
          <span class="status-dot status-${esc(item.status)}">${esc(STATUSES[item.status] || item.status)}</span>
        </div>

        <h3 class="vcard-title bn">${esc(item.title || 'Untitled Content')}</h3>

        ${item.hook_text ? `
          <div class="vcard-hook bn">
            <strong>Hook:</strong> "${esc(item.hook_text)}"
          </div>
        ` : ''}

        ${item.summary ? `
          <p class="vcard-summary">${esc(item.summary)}</p>
        ` : ''}

        ${item.comment_keyword ? `
          <div class="kw-banner ${item.resource_status === 'received' ? 'done' : ''}">
            <span>💬 Comment <u>${esc(item.comment_keyword)}</u></span>
            <span style="margin-left:auto">${item.resource_status === 'received' ? '✓ Prompt/Link Saved' : '⏳ Pending DM'}</span>
          </div>
        ` : ''}

        ${(item.tags || []).length ? `
          <div class="vcard-tags">
            ${item.tags.slice(0, 4).map(t => `<span class="tag-mini" data-filter-tag="${esc(t)}">#${esc(t)}</span>`).join('')}
          </div>
        ` : ''}

        <div class="vcard-foot">
          <span title="Shared by ${esc(item.shared_by?.name || 'Team')}">
            ${item.shared_by ? esc(item.shared_by.name) : 'BMDGL Team'} · ${relTime(item.created_at)}
          </span>
          <div class="vcard-actions">
            <span class="act-btn" title="Attached prompts & tools">🧰 ${item.resources || 0}</span>
            <button type="button" class="act-btn ${item.upvoted ? 'active-up' : ''}" data-upvote="${item.id}" title="Upvote usefulness">
              ▲ ${item.upvotes || 0}
            </button>
            <button type="button" class="act-btn ${item.favorite ? 'active-fav' : ''}" data-fav="${item.id}" title="Star item">
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
          <span class="platform-pill" style="background:${plat.color};font-size:10px;padding:1px 7px">${esc(plat.label)}</span>
          <span class="cat-badge">${esc(item.category)}</span>
          ${item.comment_keyword ? `<span class="kw-banner ${item.resource_status === 'received' ? 'done' : ''}" style="padding:1px 7px;font-size:10.5px">Comment "${esc(item.comment_keyword)}"</span>` : ''}
        </div>
        <div style="font-weight:800;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" class="bn">${esc(item.title)}</div>
        <div style="font-size:12px;color:var(--mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(item.summary || item.hook_text || '')}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        ${item.usefulness ? `<span class="score-badge">★ ${item.usefulness}/10</span>` : ''}
        <button type="button" class="act-btn ${item.upvoted ? 'active-up' : ''}" data-upvote="${item.id}">▲ ${item.upvotes || 0}</button>
        <button type="button" class="act-btn ${item.favorite ? 'active-fav' : ''}" data-fav="${item.id}">${item.favorite ? '★' : '☆'}</button>
      </div>
    </div>
  `;
}

// ---------- Specialized Libraries ----------
function renderPromptsView() {
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <div>
        <h2 style="margin:0;font-size:21px;font-weight:800">✨ Team Prompt Library</h2>
        <p style="margin:2px 0 0;color:var(--mute)">Every AI prompt saved by the team or extracted from shared Reels, YouTube videos &amp; Skool drops—ready for 1-click copy.</p>
      </div>
      <button class="btn btn-primary" id="btn-add-prompt-direct">＋ Add Prompt / Resource</button>
    </div>
    ${state.prompts.length === 0 ? `<div class="empty-state"><h3>No prompts saved yet</h3><p>Add a prompt when sharing a Reel or click "Add Prompt".</p></div>` : `
      <div class="vault-grid">
        ${state.prompts.map((p, idx) => `
          <div class="lib-card">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
              <span class="cat-badge">${esc(p.category || 'Prompt')}</span>
              <span style="font-size:11.5px;color:var(--mute)">${p.source === 'ai' ? '🤖 AI Extracted' : `👤 ${esc(p.author || 'Team')}`}</span>
            </div>
            <h3 style="margin:0;font-size:15px;font-weight:800">${esc(p.title || p.item_title)}</h3>
            <div class="prompt-block">${esc(p.content)}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:auto;padding-top:8px">
              <button class="btn btn-sm" data-open-item="${p.item_id}">▶ Open Source Item</button>
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
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <div>
        <h2 style="margin:0;font-size:21px;font-weight:800">🎯 Scroll-Stopping Hook &amp; Payoff Lab</h2>
        <p style="margin:2px 0 0;color:var(--mute)">Proven opening hooks, why they stop the scroll, payoff formulas, and ready-to-shoot Bangla adaptations for BMDGL.</p>
      </div>
    </div>
    ${state.hooks.length === 0 ? `<div class="empty-state"><h3>No analyzed hooks yet</h3></div>` : `
      <div class="vault-grid">
        ${state.hooks.map(h => `
          <div class="lib-card">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span class="cat-badge">${esc(h.hook.type || 'Scroll-Stopper')}</span>
              ${h.usefulness ? `<span class="score-badge">★ ${h.usefulness}/10</span>` : ''}
            </div>
            <div class="vcard-hook bn" style="font-size:14px;font-weight:700">
              "${esc(h.hook.text)}"
            </div>
            ${h.hook.visual ? `<div style="font-size:12px"><strong>🎬 First Frame Visual:</strong> ${esc(h.hook.visual)}</div>` : ''}
            ${h.hook.why_it_works ? `<div style="font-size:12px;color:var(--ink-2)"><strong>💡 Why it works:</strong> ${esc(h.hook.why_it_works)}</div>` : ''}
            ${h.payoff ? `<div style="font-size:12px;color:var(--green)"><strong>🎁 Payoff:</strong> ${esc(h.payoff)}</div>` : ''}
            ${(h.bangla_hooks || []).length ? `
              <div style="background:var(--surface-2);padding:9px 11px;border-radius:8px;border:1px solid var(--border)">
                <div style="font-size:11px;font-weight:800;color:var(--primary);text-transform:uppercase;margin-bottom:4px">🇧🇩 Bangla Adaptations for BMDGL</div>
                <ul style="margin:0;padding-left:16px;font-size:12.5px" class="bn">
                  ${h.bangla_hooks.map(bh => `<li>${esc(bh)}</li>`).join('')}
                </ul>
              </div>
            ` : ''}
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:auto;padding-top:8px">
              <button class="btn btn-sm" data-open-item="${h.item_id}">▶ Watch &amp; Full Breakdown</button>
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
    <div style="margin-bottom:16px">
      <h2 style="margin:0;font-size:21px;font-weight:800">🧰 Tools, Drive Folders &amp; Skool Drops</h2>
      <p style="margin:2px 0 0;color:var(--mute)">All external tools, Google Drive folders, SOP notes, and community links collected across the team's shared content.</p>
    </div>
    ${state.tools.length === 0 ? `<div class="empty-state"><h3>No tools or links saved yet</h3></div>` : `
      <div class="vault-grid">
        ${state.tools.map(t => `
          <div class="lib-card">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span class="cat-badge">${esc(RESOURCE_KINDS[t.kind] || t.kind || 'Tool')}</span>
              <span style="font-size:11.5px;color:var(--mute)">From: ${esc(t.item_title)}</span>
            </div>
            <h3 style="margin:0;font-size:15.5px;font-weight:800">${esc(t.title || 'Resource')}</h3>
            ${t.content ? `<p style="margin:0;font-size:12.8px;color:var(--ink-2);white-space:pre-wrap">${esc(t.content)}</p>` : ''}
            <div style="display:flex;gap:8px;margin-top:auto;padding-top:8px">
              <button class="btn btn-sm" data-open-item="${t.item_id}">▶ Source Video/Post</button>
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
        <h3 style="margin:0;font-size:17px;font-weight:800">👥 BMDGL Vault Team (${members.length})</h3>
        <p style="margin:0;color:var(--mute);font-size:12.5px">Share the invite code below with Bright Mind teammates so they can create their account.</p>
        ${inviteCode ? `
          <div class="info-box" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
            <div>
              <div style="font-size:11px;font-weight:800;color:var(--mute);text-transform:uppercase">Team Invite Code</div>
              <div style="font-family:var(--font-mono);font-size:17px;font-weight:800;color:var(--primary)">${esc(inviteCode)}</div>
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-sm btn-primary" data-copy-text="${esc(inviteCode)}">Copy Code</button>
              <button class="btn btn-sm" id="btn-regen-invite">Rotate</button>
            </div>
          </div>
        ` : ''}
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:6px">
          ${members.map(m => `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:9px">
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
        <h3 style="margin:0;font-size:17px;font-weight:800">📦 Data Export &amp; Backups</h3>
        <p style="margin:0;color:var(--mute);font-size:12.5px">Download your swipe file in CSV or full JSON database backup.</p>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">
          <a href="/api/export.csv" class="btn btn-primary" style="justify-content:flex-start;padding:12px 14px">
            📊 Export Entire Swipe File to CSV (Excel / Google Sheets)
          </a>
          ${state.user.role === 'admin' ? `
            <a href="/api/export.json" class="btn" style="justify-content:flex-start;padding:12px 14px">
              🗄️ Download Full JSON Database Backup
            </a>
          ` : ''}
        </div>

        <div class="info-box" style="margin-top:12px">
          <h4>System Capabilities</h4>
          <div style="font-size:12.5px;display:flex;flex-direction:column;gap:4px">
            <div>• <strong>Inline Playback:</strong> HTML5 Offline MP4 + YouTube / IG / FB / TikTok / Drive / Loom embeds</div>
            <div>• <strong>Offline Video Archiver (yt-dlp):</strong> ${state.boot?.features?.archive ? '✅ Installed & Active' : '⚠️ Not detected'}</div>
            <div>• <strong>FFmpeg Thumbnail Engine:</strong> ${state.boot?.features?.ffmpeg ? '✅ Installed & Active' : '⚠️ Not detected'}</div>
            <div>• <strong>Multimodal Gemini AI Breakdown:</strong> ${state.boot?.features?.ai ? `✅ Active (${esc(state.boot.features.aiModel)})` : 'ℹ️ Ready (add GEMINI_API_KEY in .env for live auto-analysis; manual & rule breakdowns active)'}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ---------- Share / Add Content Modal ----------
function openShareModal(prefill = {}) {
  const root = document.getElementById('modal-root');
  const resources = prefill.resources || [{ kind: 'prompt', title: '', content: '', url: '' }];

  const renderResRows = () => resources.map((r, i) => `
    <div class="res-builder-card" data-res-idx="${i}">
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <select class="res-kind" style="width:160px">
          ${Object.entries(RESOURCE_KINDS).map(([k, v]) => `<option value="${k}" ${r.kind === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
        </select>
        <input class="res-title" style="flex:1" placeholder="Title (e.g. Viral Hook Prompt / Drive Folder / Tool Name)" value="${esc(r.title)}">
        ${resources.length > 1 ? `<button type="button" class="btn btn-sm btn-danger" data-remove-res="${i}">✕</button>` : ''}
      </div>
      <textarea class="res-content" rows="2" placeholder="Paste the exact prompt text, steps, or instructions here…" style="width:100%;margin-bottom:6px">${esc(r.content)}</textarea>
      <input class="res-url" style="width:100%" placeholder="Optional tool / Google Drive / Skool URL (https://…)" value="${esc(r.url)}">
    </div>
  `).join('');

  root.innerHTML = `
    <div class="modal-backdrop" id="share-modal-backdrop">
      <div class="modal-dialog">
        <div class="modal-head">
          <h3>＋ Share Useful Content to BMDGL Vault</h3>
          <button class="icon-btn" id="btn-close-share">✕</button>
        </div>
        <form id="share-form" class="modal-body">
          <div class="field">
            <label>Content URL (Facebook / Instagram Reel or Post, YouTube, TikTok, Skool, Drive…)</label>
            <input name="url" id="share-url-input" placeholder="https://www.instagram.com/reel/... or https://www.facebook.com/..." value="${esc(prefill.url || '')}">
            <div id="share-url-preview" style="font-size:12px;color:var(--primary);margin-top:3px"></div>
          </div>

          <div class="form-grid">
            <div class="field">
              <label>Title (optional — auto-filled if blank)</label>
              <input name="title" placeholder="e.g. 3 Free AI SFX Tools for Video Editing" value="${esc(prefill.title || '')}">
            </div>
            <div class="field">
              <label>Category</label>
              <select name="category">
                <option value="">Auto-detect Category</option>
                ${CATEGORIES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="form-grid">
            <div class="field">
              <label>"Comment Keyword" Trigger (if Reel says 'Comment X for link')</label>
              <input name="comment_keyword" placeholder="e.g. PROMPT, SOUND, AUDIT" value="${esc(prefill.comment_keyword || '')}">
            </div>
            <div class="field">
              <label>Did we get the Prompt / Resource yet?</label>
              <select name="resource_status">
                ${Object.entries(RESOURCE_STATUSES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="field">
            <label>What Can This Content / Tool Do? &amp; Why We Saved It (Summary / Notes)</label>
            <textarea name="notes" rows="2" placeholder="Explain what this content/tool does or how BMDGL can adapt its Hook/Story/Payoff…">${esc(prefill.notes || '')}</textarea>
          </div>

          <div style="margin:14px 0 8px;display:flex;align-items:center;justify-content:space-between">
            <label style="font-size:12.5px;font-weight:800;color:var(--ink)">🧰 Attached Prompts, Tools, Drive Folders or Skool Links</label>
            <button type="button" class="btn btn-sm" id="btn-add-res-row">＋ Add Another Prompt/Tool</button>
          </div>
          <div id="res-rows-container">${renderResRows()}</div>

          <div class="form-grid">
            <div class="field">
              <label>Tags (comma-separated)</label>
              <input name="tags" placeholder="hooks, bangla-reel, ai-tools, f-commerce">
            </div>
            <div class="field">
              <label>Upload Video / Screenshot / PDF (optional)</label>
              <input type="file" id="share-files" multiple accept=".mp4,.mov,.webm,.jpg,.jpeg,.png,.webp,.pdf,.txt,.md,.docx">
            </div>
          </div>

          ${state.collections.length ? `
            <div class="field">
              <label>Add to Collections</label>
              <div style="display:flex;flex-wrap:wrap;gap:8px">
                ${state.collections.map(c => `
                  <label style="display:inline-flex;align-items:center;gap:5px;font-weight:600;background:var(--surface-2);padding:4px 10px;border-radius:16px;border:1px solid var(--border)">
                    <input type="checkbox" name="coll" value="${c.id}"> ${esc(c.emoji || '📁')} ${esc(c.name)}
                  </label>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </form>
        <div class="modal-foot">
          <button type="button" class="btn" id="btn-cancel-share">Cancel</button>
          <button type="submit" form="share-form" class="btn btn-primary" id="btn-submit-share">Save to Vault &amp; Analyze →</button>
        </div>
      </div>
    </div>
  `;

  const syncResFromDom = () => {
    root.querySelectorAll('[data-res-idx]').forEach(el => {
      const i = Number(el.dataset.resIdx);
      resources[i] = {
        kind: el.querySelector('.res-kind').value,
        title: el.querySelector('.res-title').value,
        content: el.querySelector('.res-content').value,
        url: el.querySelector('.res-url').value,
      };
    });
  };

  const bindResEvents = () => {
    root.querySelectorAll('[data-remove-res]').forEach(btn => {
      btn.addEventListener('click', () => {
        syncResFromDom();
        resources.splice(Number(btn.dataset.removeRes), 1);
        root.querySelector('#res-rows-container').innerHTML = renderResRows();
        bindResEvents();
      });
    });
  };
  bindResEvents();

  root.querySelector('#btn-add-res-row').addEventListener('click', () => {
    syncResFromDom();
    resources.push({ kind: 'tool', title: '', content: '', url: '' });
    root.querySelector('#res-rows-container').innerHTML = renderResRows();
    bindResEvents();
  });

  const urlInput = root.querySelector('#share-url-input');
  const previewEl = root.querySelector('#share-url-preview');
  const checkPreview = async () => {
    const raw = extractUrl(urlInput.value) || urlInput.value.trim();
    const info = analyzeUrl(raw);
    if (!info) { previewEl.textContent = ''; return; }
    const plat = PLATFORMS[info.platform] || PLATFORMS.web;
    previewEl.textContent = `✓ Detected ${plat.label} ${CONTENT_TYPES[info.contentType] || 'link'} — will play inline in Vault`;
    try {
      const res = await api('/api/preview', { method: 'POST', body: { url: raw } });
      if (res.duplicate) {
        previewEl.innerHTML = `⚠️ Already in Vault: <strong>${esc(res.duplicate.title)}</strong> (shared by ${esc(res.duplicate.sharer || 'team')})`;
      }
    } catch { /* ignore */ }
  };
  urlInput.addEventListener('input', checkPreview);
  if (urlInput.value) checkPreview();

  const close = () => { root.innerHTML = ''; if (location.hash.startsWith('#/add')) history.replaceState(null, '', '#/'); };
  root.querySelector('#btn-close-share').addEventListener('click', close);
  root.querySelector('#btn-cancel-share').addEventListener('click', close);
  root.querySelector('#share-modal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'share-modal-backdrop') close();
  });

  root.querySelector('#share-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    syncResFromDom();
    const form = e.target;
    const btn = root.querySelector('#btn-submit-share');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const colls = [...form.querySelectorAll('input[name="coll"]:checked')].map(c => Number(c.value));
      const data = {
        url: form.url.value.trim(),
        title: form.title.value.trim(),
        category: form.category.value,
        comment_keyword: form.comment_keyword.value.trim(),
        resource_status: form.resource_status.value,
        notes: form.notes.value.trim(),
        tags: form.tags.value,
        collections: colls,
        resources,
      };
      const files = root.querySelector('#share-files').files;
      let res;
      if (files && files.length) {
        const fd = new FormData();
        fd.append('data', JSON.stringify(data));
        for (const f of files) fd.append('files', f);
        res = await api('/api/items', { method: 'POST', body: fd });
      } else {
        res = await api('/api/items', { method: 'POST', body: data });
      }
      close();
      toast('✓ Saved to Vault!');
      await loadAllData();
      openItemDetail(res.item.id);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Save to Vault & Analyze →';
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
  const hasOffline = Boolean(item.media?.url);
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
      viewportHtml = `<video src="${esc(item.media.url)}" controls autoplay playsinline poster="${esc(item.thumb || '')}"></video>`;
    }
  } else if (mode === 'embed' && hasEmbed) {
    if (info.embed.kind === 'video') {
      viewportHtml = `<video src="${esc(info.embed.src)}" controls autoplay playsinline></video>`;
    } else if (info.embed.kind === 'image') {
      viewportHtml = `<img src="${esc(info.embed.src)}" alt="${esc(item.title)}">`;
    } else {
      viewportHtml = `<iframe src="${esc(info.embed.src)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    }
  } else if (item.thumb) {
    viewportHtml = `
      <div style="text-align:center;padding:18px">
        <img src="${esc(item.thumb)}" alt="" style="max-height:320px;border-radius:10px;margin-bottom:12px">
        <div style="color:#CBD5E1;font-size:13px;margin-bottom:10px">This platform (${esc(PLATFORMS[item.platform]?.label || item.platform)}) does not provide an public iframe embed, or requires login.</div>
        <div style="display:flex;gap:8px;justify-content:center">
          ${item.canonical_url ? `<a href="${esc(item.canonical_url)}" target="_blank" rel="noopener" class="btn btn-primary">↗ Open Original Link</a>` : ''}
          ${state.boot?.features?.archive && item.canonical_url ? `<button class="btn" id="btn-stage-archive">⬇️ Download Offline Copy into Vault</button>` : ''}
        </div>
      </div>
    `;
  } else {
    viewportHtml = `
      <div style="text-align:center;padding:28px;max-width:420px">
        <div style="font-size:36px;margin-bottom:8px">🎬</div>
        <div style="font-weight:800;font-size:16px;margin-bottom:6px" class="bn">${esc(item.title)}</div>
        <p style="color:#94A3B8;font-size:12.5px;margin-bottom:14px">
          ${item.archive_status === 'processing' ? '⏳ Downloading offline video copy via yt-dlp right now…' : 'Watch on the source platform or save an offline MP4 copy into the Vault.'}
        </p>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
          ${item.canonical_url ? `<a href="${esc(item.canonical_url)}" target="_blank" rel="noopener" class="btn btn-primary">↗ Open Source Link</a>` : ''}
          ${state.boot?.features?.archive && item.canonical_url && item.archive_status !== 'processing' ? `<button class="btn" id="btn-stage-archive">⬇️ Pull Video into Vault (yt-dlp)</button>` : ''}
        </div>
      </div>
    `;
  }

  return `
    <div class="detail-stage">
      <div class="stage-toolbar">
        <div class="stage-modes">
          ${hasOffline ? `<button type="button" class="${mode === 'offline' ? 'active' : ''}" data-stage-mode="offline">▶ Vault Player (Instant)</button>` : ''}
          ${hasEmbed ? `<button type="button" class="${mode === 'embed' ? 'active' : ''}" data-stage-mode="embed">🌐 Platform Embed</button>` : ''}
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          ${!hasOffline && state.boot?.features?.archive && item.canonical_url ? `
            <button type="button" class="stage-modes" id="btn-stage-archive" style="background:rgba(255,255,255,0.12);color:#fff;border:none;border-radius:6px;padding:4px 9px;font-size:11px;font-weight:700">
              ${item.archive_status === 'processing' ? '⏳ Archiving…' : '⬇️ Save Offline MP4'}
            </button>
          ` : ''}
        </div>
      </div>
      <div class="stage-viewport">
        ${viewportHtml}
      </div>
      <div class="stage-foot">
        <span>${esc(PLATFORMS[item.platform]?.label || item.platform)} · ${esc(CONTENT_TYPES[item.content_type] || item.content_type)}${item.author_name ? ` · ${esc(item.author_name)}` : ''}</span>
        ${item.canonical_url ? `<a href="${esc(item.canonical_url)}" target="_blank" rel="noopener">↗ Open Original</a>` : ''}
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
            <select id="detail-status-select" class="filter-select" title="Workflow Status">
              ${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}" ${item.status === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
            </select>
            <button class="act-btn ${item.upvoted ? 'active-up' : ''}" id="detail-upvote">▲ ${item.upvotes || 0}</button>
            <button class="act-btn ${item.favorite ? 'active-fav' : ''}" id="detail-fav">${item.favorite ? '★ Starred' : '☆ Star'}</button>
            <button class="icon-btn" id="detail-close">✕</button>
          </div>
        </div>

        <div class="detail-split">
          ${renderStagePlayer(item)}

          <div class="detail-pane">
            <div class="detail-tabs">
              <button type="button" class="${state.activeTab === 'breakdown' ? 'active' : ''}" data-dtab="breakdown">🎯 Summary &amp; Hook/Story/Payoff</button>
              <button type="button" class="${state.activeTab === 'resources' ? 'active' : ''}" data-dtab="resources">🧰 Prompts, Tools &amp; Files (${(item.resources_list?.length || 0) + (item.attachments?.length || 0)})</button>
              <button type="button" class="${state.activeTab === 'adapt' ? 'active' : ''}" data-dtab="adapt">🇧🇩 BMDGL Adaptation</button>
              <button type="button" class="${state.activeTab === 'discussion' ? 'active' : ''}" data-dtab="discussion">💬 Team Notes (${item.comments_list?.length || 0})</button>
              <button type="button" class="${state.activeTab === 'edit' ? 'active' : ''}" data-dtab="edit">✏️ Edit Details</button>
            </div>

            ${state.activeTab === 'breakdown' ? `
              ${item.comment_keyword ? `
                <div class="kw-banner ${item.resource_status === 'received' ? 'done' : ''}" style="padding:9px 12px;font-size:12.5px">
                  <span>💬 Creator CTA: <strong>Comment "${esc(item.comment_keyword)}"</strong></span>
                  <select id="detail-res-status" class="filter-select" style="margin-left:auto;padding:3px 8px">
                    ${Object.entries(RESOURCE_STATUSES).map(([k, v]) => `<option value="${k}" ${item.resource_status === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
                  </select>
                </div>
              ` : ''}

              <div class="info-box">
                <h4>
                  <span>📋 Accurate Summary &amp; What It Can Do</span>
                  ${item.usefulness ? `<span class="score-badge">Usefulness: ★ ${item.usefulness}/10</span>` : ''}
                </h4>
                <p style="margin:0 0 8px;font-size:13.5px;color:var(--ink)"><strong>Summary:</strong> ${esc(item.summary || ai.summary || item.notes || item.caption || 'No summary yet — click Edit Details or Re-Analyze.')}</p>
                ${(item.what_it_does || ai.what_it_does) ? `
                  <p style="margin:0;font-size:13.5px;color:var(--primary)"><strong>What it can do for BMDGL:</strong> ${esc(item.what_it_does || ai.what_it_does)}</p>
                ` : ''}
              </div>

              <div class="hsp-grid">
                <div class="hsp-card hook">
                  <div class="hsp-kicker">
                    <span>1. Scroll-Stopping Hook (0–3s)</span>
                    <span>${esc(hook.type || 'Opening Hook')}</span>
                  </div>
                  <div style="font-size:14.5px;font-weight:800;margin-bottom:4px" class="bn">"${esc(hook.text || 'See video opening')}"</div>
                  ${hook.visual ? `<div style="font-size:12.5px;color:var(--ink-2)"><strong>Visual:</strong> ${esc(hook.visual)}</div>` : ''}
                  ${hook.why_it_works ? `<div style="font-size:12.5px;color:var(--mute);margin-top:2px"><strong>Why it stops the scroll:</strong> ${esc(hook.why_it_works)}</div>` : ''}
                </div>

                <div class="hsp-card story">
                  <div class="hsp-kicker"><span>2. Story Structure &amp; Retention Beats</span></div>
                  ${story.structure ? `<div style="font-weight:700;font-size:13px;margin-bottom:6px">${esc(story.structure)}</div>` : ''}
                  ${(story.beats || []).length ? `
                    <ul style="margin:0;padding-left:18px;font-size:12.5px;color:var(--ink-2)">
                      ${story.beats.map(b => `<li>${esc(b)}</li>`).join('')}
                    </ul>
                  ` : `<div style="font-size:12.5px;color:var(--mute)">${esc(item.notes || 'Watch player on the left to study pacing.')}</div>`}
                </div>

                <div class="hsp-card payoff">
                  <div class="hsp-kicker"><span>3. The Payoff &amp; Call To Action</span></div>
                  <div style="font-size:13px"><strong>Viewer Reward / Payoff:</strong> ${esc(ai.payoff || 'Delivers concrete tool/framework promised in the hook.')}</div>
                  ${ai.cta ? `<div style="font-size:12.5px;color:var(--mute);margin-top:4px"><strong>CTA:</strong> ${esc(ai.cta)}</div>` : ''}
                </div>
              </div>

              ${(ai.key_takeaways || []).length ? `
                <div class="info-box">
                  <h4>Key Takeaways</h4>
                  <ul style="margin:0;padding-left:18px;font-size:13px">
                    ${ai.key_takeaways.map(k => `<li>${esc(k)}</li>`).join('')}
                  </ul>
                </div>
              ` : ''}

              ${ai.transcript ? `
                <div class="info-box">
                  <h4><span>Spoken Transcript</span> <button class="btn btn-sm" data-copy-text="${esc(ai.transcript)}">Copy</button></h4>
                  <div style="font-size:12.5px;color:var(--ink-2);white-space:pre-wrap">${esc(ai.transcript)}</div>
                </div>
              ` : ''}
            ` : ''}

            ${state.activeTab === 'resources' ? `
              <div style="display:flex;justify-content:space-between;align-items:center">
                <h4 style="margin:0;font-size:14px">Attached Prompts, Tools, Drive Folders &amp; Skool Links</h4>
              </div>

              ${(item.resources_list || []).map(r => `
                <div class="info-box">
                  <h4>
                    <span><span class="cat-badge">${esc(RESOURCE_KINDS[r.kind] || r.kind)}</span> ${esc(r.title || 'Resource')}</span>
                    <div style="display:flex;gap:6px">
                      ${r.content ? `<button class="btn btn-sm btn-primary" data-copy-text="${esc(r.content)}">📋 Copy</button>` : ''}
                      ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener" class="btn btn-sm">↗ Open Link</a>` : ''}
                      <button class="btn btn-sm btn-danger" data-del-res="${r.id}">✕</button>
                    </div>
                  </h4>
                  ${r.content ? `<div class="prompt-block">${esc(r.content)}</div>` : ''}
                  ${r.url ? `<div style="font-size:12px;margin-top:6px"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a></div>` : ''}
                </div>
              `).join('')}

              ${(ai.tools_mentioned || []).length ? `
                <div class="info-box">
                  <h4>Tools Detected in Content</h4>
                  <div style="display:flex;flex-direction:column;gap:6px">
                    ${ai.tools_mentioned.map(t => `
                      <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px">
                        <div><strong>${esc(t.name)}</strong> — ${esc(t.purpose)}</div>
                        ${t.url ? `<a href="${esc(t.url)}" target="_blank" class="btn btn-sm">↗</a>` : ''}
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}

              <form id="add-res-form" class="info-box">
                <h4>＋ Attach New Prompt / Tool / Drive Folder</h4>
                <div class="form-grid">
                  <div class="field">
                    <label>Resource Type</label>
                    <select name="kind">
                      ${Object.entries(RESOURCE_KINDS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
                    </select>
                  </div>
                  <div class="field">
                    <label>Title</label>
                    <input name="title" placeholder="e.g. Exact Midjourney / Claude Prompt">
                  </div>
                </div>
                <div class="field">
                  <label>Prompt / Instructions / Notes</label>
                  <textarea name="content" rows="3" placeholder="Paste the prompt or instructions…"></textarea>
                </div>
                <div class="field">
                  <label>Link (Google Drive / Skool / Tool URL)</label>
                  <input name="url" placeholder="https://…">
                </div>
                <button type="submit" class="btn btn-primary btn-sm">Save Resource</button>
              </form>

              <div class="info-box">
                <h4>Uploaded Files (${item.attachments?.length || 0})</h4>
                ${(item.attachments || []).map(a => `
                  <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
                    <a href="${esc(a.url)}" target="_blank">${esc(a.name)} (${formatBytes(a.size)})</a>
                    <button class="btn btn-sm btn-danger" data-del-att="${a.id}">✕</button>
                  </div>
                `).join('')}
                <form id="upload-att-form" style="margin-top:10px;display:flex;gap:8px;align-items:center">
                  <input type="file" name="files" multiple required style="flex:1">
                  <button type="submit" class="btn btn-sm btn-primary">Upload File</button>
                </form>
              </div>
            ` : ''}

            ${state.activeTab === 'adapt' ? `
              <div class="info-box">
                <h4>🇧🇩 Ready-to-Shoot Bangla Hooks for BMDGL</h4>
                ${(ai.bangla_hooks || []).length ? `
                  <div style="display:flex;flex-direction:column;gap:8px">
                    ${ai.bangla_hooks.map(bh => `
                      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;background:var(--surface);padding:9px 12px;border-radius:8px;border:1px solid var(--border)">
                        <span class="bn" style="font-weight:700;font-size:14px">${esc(bh)}</span>
                        <button class="btn btn-sm" data-copy-text="${esc(bh)}">Copy</button>
                      </div>
                    `).join('')}
                  </div>
                ` : `<p style="margin:0;color:var(--mute)">Add Bangla hook ideas in Edit Details or run AI Re-Analyze.</p>`}
              </div>

              <div class="info-box">
                <h4>How BMDGL Can Adapt This for Bangladeshi SMEs / F-Commerce</h4>
                ${(ai.how_to_adapt || []).length ? `
                  <ul style="margin:0;padding-left:18px;font-size:13.5px">
                    ${ai.how_to_adapt.map(x => `<li>${esc(x)}</li>`).join('')}
                  </ul>
                ` : `<p style="margin:0;color:var(--mute)">${esc(item.notes || 'No adaptation notes yet.')}</p>`}
              </div>

              <div class="info-box">
                <h4>Collections</h4>
                <div style="display:flex;flex-wrap:wrap;gap:8px">
                  ${state.collections.map(c => {
                    const checked = (item.collections || []).some(ic => ic.id === c.id);
                    return `
                      <label style="display:inline-flex;align-items:center;gap:6px;background:var(--surface);padding:5px 11px;border-radius:16px;border:1px solid var(--border);font-weight:600">
                        <input type="checkbox" class="detail-coll-chk" value="${c.id}" ${checked ? 'checked' : ''}>
                        ${esc(c.emoji || '📁')} ${esc(c.name)}
                      </label>
                    `;
                  }).join('')}
                </div>
              </div>
            ` : ''}

            ${state.activeTab === 'discussion' ? `
              <div class="info-box">
                <h4>Sharer's Note (${esc(item.shared_by?.name || 'Team')})</h4>
                <p style="margin:0;white-space:pre-wrap">${esc(item.notes || 'No initial note.')}</p>
              </div>

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
                <input name="body" required placeholder="Add a team note, script idea, or update…" style="flex:1;padding:9px 12px;border-radius:9px;border:1px solid var(--border);background:var(--surface-2)">
                <button type="submit" class="btn btn-primary">Post Note</button>
              </form>
            ` : ''}

            ${state.activeTab === 'edit' ? `
              <form id="edit-item-form">
                <div class="field">
                  <label>Title</label>
                  <input name="title" value="${esc(item.title)}">
                </div>
                <div class="form-grid">
                  <div class="field">
                    <label>Category</label>
                    <select name="category">
                      ${CATEGORIES.map(c => `<option value="${esc(c)}" ${item.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
                    </select>
                  </div>
                  <div class="field">
                    <label>Content Type</label>
                    <select name="content_type">
                      ${Object.entries(CONTENT_TYPES).map(([k, v]) => `<option value="${k}" ${item.content_type === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
                    </select>
                  </div>
                </div>
                <div class="field">
                  <label>Summary (What happens in this content)</label>
                  <textarea name="summary" rows="2">${esc(item.summary || '')}</textarea>
                </div>
                <div class="field">
                  <label>What It Can Do for BMDGL</label>
                  <textarea name="what_it_does" rows="2">${esc(item.what_it_does || '')}</textarea>
                </div>
                <div class="field">
                  <label>Team Notes</label>
                  <textarea name="notes" rows="2">${esc(item.notes || '')}</textarea>
                </div>
                <div class="form-grid">
                  <div class="field">
                    <label>Comment Keyword</label>
                    <input name="comment_keyword" value="${esc(item.comment_keyword || '')}">
                  </div>
                  <div class="field">
                    <label>Tags (comma-separated)</label>
                    <input name="tags" value="${esc((item.tags || []).join(', '))}">
                  </div>
                </div>
                <div style="display:flex;justify-content:space-between;margin-top:12px">
                  <button type="button" class="btn btn-danger" id="btn-delete-item">🗑️ Delete Item</button>
                  <div style="display:flex;gap:8px">
                    ${state.boot?.features?.ai ? `<button type="button" class="btn" id="btn-reanalyze">🤖 Re-run AI Analysis</button>` : ''}
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
    toast('Resource status updated');
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
      toast('Downloading video via yt-dlp…');
      renderModal();
      scheduleBackgroundPoll();
    } catch (e) { toast(e.message, true); }
  });

  root.querySelector('#add-res-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const res = await api(`/api/items/${item.id}/resources`, { method: 'POST', body: Object.fromEntries(fd.entries()) });
      state.activeItem = res.item;
      toast('✓ Resource added');
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

  root.querySelector('#upload-att-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const res = await api(`/api/items/${item.id}/attachments`, { method: 'POST', body: fd });
      state.activeItem = res.item;
      toast('✓ File uploaded');
      renderModal();
      loadAllData();
    } catch (err) { toast(err.message, true); }
  });

  root.querySelectorAll('[data-del-att]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const res = await api(`/api/attachments/${btn.dataset.delAtt}`, { method: 'DELETE' });
      state.activeItem = res.item;
      renderModal();
    });
  });

  root.querySelectorAll('.detail-coll-chk').forEach(chk => {
    chk.addEventListener('change', async () => {
      const ids = [...root.querySelectorAll('.detail-coll-chk:checked')].map(c => Number(c.value));
      const res = await api(`/api/items/${item.id}/collections`, { method: 'PUT', body: { ids } });
      state.activeItem = res.item;
      toast('Collections updated');
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
    toast('✓ Changes saved');
    renderModal();
    loadAllData();
  });

  root.querySelector('#btn-reanalyze')?.addEventListener('click', async () => {
    try {
      const res = await api(`/api/items/${item.id}/reanalyze`, { method: 'POST' });
      state.activeItem = res.item;
      toast('AI analysis queued');
      renderModal();
      scheduleBackgroundPoll();
    } catch (e) { toast(e.message, true); }
  });

  root.querySelector('#btn-delete-item')?.addEventListener('click', async () => {
    if (!confirm('Delete this item from the Vault?')) return;
    try {
      await api(`/api/items/${item.id}`, { method: 'DELETE' });
      close();
      toast('Item deleted');
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

  app.querySelector('#btn-open-share')?.addEventListener('click', () => openShareModal());
  app.querySelector('#btn-empty-share')?.addEventListener('click', () => openShareModal());
  app.querySelector('#btn-add-prompt-direct')?.addEventListener('click', () => openShareModal({ resources: [{ kind: 'prompt', title: '', content: '', url: '' }] }));

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

  app.querySelectorAll('[data-quick-filter]').forEach(el => {
    el.addEventListener('click', () => {
      const qf = el.dataset.quickFilter;
      state.view = 'vault';
      for (const k of Object.keys(state.filters)) if (k !== 'sort') state.filters[k] = '';
      if (qf === 'pending') state.filters.pending = '1';
      else if (qf === 'testing') state.filters.status = 'testing';
      else if (qf === 'used') state.filters.status = 'used';
      loadItems();
    });
  });

  app.querySelectorAll('[data-quick-view], [data-view]').forEach(btn => {
    btn.addEventListener('click', async () => {
      state.sidebarOpen = false;
      const v = btn.dataset.view || btn.dataset.quickView;
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

  app.querySelectorAll('[data-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.sidebarOpen = false;
      state.view = 'vault';
      state.filters.category = state.filters.category === btn.dataset.cat ? '' : btn.dataset.cat;
      loadItems();
    });
  });

  app.querySelector('#btn-new-collection')?.addEventListener('click', async () => {
    const name = prompt('New collection name (e.g. "Ramadan Campaign Ideas"):');
    if (!name || !name.trim()) return;
    try {
      await api('/api/collections', { method: 'POST', body: { name: name.trim(), emoji: '📁' } });
      await loadAllData();
      toast('✓ Collection created');
    } catch (e) { toast(e.message, true); }
  });

  app.querySelectorAll('[data-plat]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.filters.platform = btn.dataset.plat;
      loadItems();
    });
  });

  app.querySelector('#flt-type')?.addEventListener('change', (e) => { state.filters.type = e.target.value; loadItems(); });
  app.querySelector('#flt-category')?.addEventListener('change', (e) => { state.filters.category = e.target.value; loadItems(); });
  app.querySelector('#flt-status')?.addEventListener('change', (e) => { state.filters.status = e.target.value; loadItems(); });
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

  app.querySelector('#quick-paste-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = app.querySelector('#quick-paste-input').value.trim();
    openShareModal({ url: val });
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
    renderAuth();
  });

  // Card interactions
  app.querySelectorAll('[data-open-item]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('button, a, [data-filter-tag]')) return;
      openItemDetail(Number(el.dataset.openItem));
    });
  });

  app.querySelectorAll('[data-filter-tag]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      state.filters.tag = el.dataset.filterTag;
      loadItems();
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

  app.querySelector('#btn-regen-invite')?.addEventListener('click', async () => {
    const res = await api('/api/team/invite/regenerate', { method: 'POST' });
    state.team.inviteCode = res.inviteCode;
    renderApp();
    toast('New invite code generated');
  });
}

function handleHashRoute() {
  if (!state.user) return;
  const h = location.hash || '';
  if (h.startsWith('#/add')) {
    const q = new URLSearchParams(h.split('?')[1] || '');
    openShareModal({ url: q.get('url') || '', notes: q.get('note') || '' });
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
      openShareModal();
    }
  });
}

init();
