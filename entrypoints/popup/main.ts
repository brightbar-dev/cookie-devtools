import { escapeHtml, cookieUrl, formatTime, CAUSE_MAP } from '@/utils/cookies';
import type { CookieLike } from '@/utils/cookies';
import './style.css';

let currentUrl = '';
let currentDomain = '';
let allCookies: CookieLike[] = [];
let editingCookie: CookieLike | null = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const data = await browser.storage.local.get({ theme: 'auto' });
  applyTheme(data.theme as string);

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) {
    try {
      const url = new URL(tab.url);
      currentUrl = url.origin + url.pathname;
      currentDomain = url.hostname;
    } catch {
      currentDomain = '';
    }
  }

  setupTabs();
  setupSearch();
  setupActions();
  setupEditor();
  setupExportMenu();
  setupProfiles();
  loadCookies();
}

function applyTheme(theme: string) {
  if (theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.body.classList.add('dark');
  } else {
    document.body.classList.remove('dark');
  }
}

function toast(message: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2100);
}

// Tab navigation

function setupTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((tc) => tc.classList.remove('active'));
      tab.classList.add('active');
      const tabName = (tab as HTMLElement).dataset.tab;
      document.getElementById('tab-' + tabName)!.classList.add('active');

      if (tabName === 'monitor') loadChangeLog();
      if (tabName === 'profiles') loadProfiles();
    });
  });
}

// Cookie list

function setupSearch() {
  document.getElementById('search')!.addEventListener('input', renderCookies);
}

async function loadCookies() {
  const domainInfo = document.getElementById('domain-info')!;
  if (currentDomain) {
    domainInfo.textContent = currentDomain;
    const response = await browser.runtime.sendMessage({ action: 'getCookies', url: currentUrl });
    allCookies = (response as { cookies: CookieLike[] }).cookies || [];
  } else {
    domainInfo.textContent = 'No active page';
    allCookies = [];
  }
  renderCookies();
}

function renderCookies() {
  const filter = (document.getElementById('search') as HTMLInputElement).value.toLowerCase();
  const list = document.getElementById('cookie-list')!;
  const empty = document.getElementById('cookie-empty')!;

  const filtered = allCookies.filter((c) =>
    c.name.toLowerCase().includes(filter) ||
    c.value.toLowerCase().includes(filter) ||
    c.domain.toLowerCase().includes(filter)
  );

  if (filtered.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    document.getElementById('cookie-count')!.textContent = '0 cookies';
    return;
  }

  empty.style.display = 'none';
  document.getElementById('cookie-count')!.textContent =
    `${filtered.length} cookie${filtered.length !== 1 ? 's' : ''}`;

  list.innerHTML = filtered.map((cookie, i) => {
    const badges: string[] = [];
    if (cookie.secure) badges.push('<span class="badge badge-secure">S</span>');
    if (cookie.httpOnly) badges.push('<span class="badge badge-httponly">H</span>');
    if (cookie.session) badges.push('<span class="badge badge-session">Ses</span>');
    const ss = cookie.sameSite;
    if (ss && ss !== 'unspecified') {
      const label = ss === 'no_restriction' ? 'None' : ss.charAt(0).toUpperCase() + ss.slice(1);
      badges.push(`<span class="badge badge-samesite-${ss}">${label}</span>`);
    }

    return `
      <div class="cookie-item" data-index="${i}">
        <span class="cookie-name" title="${escapeHtml(cookie.name)}">${escapeHtml(cookie.name)}</span>
        <span class="cookie-value" title="${escapeHtml(cookie.value)}">${escapeHtml(cookie.value)}</span>
        <span class="cookie-badges">${badges.join('')}</span>
        <span class="cookie-actions">
          <button class="btn-edit" title="Edit">&#9998;</button>
          <button class="btn-copy" title="Copy value">&#10697;</button>
          <button class="btn-delete" title="Delete">&#10005;</button>
        </span>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.cookie-item').forEach((item) => {
    const idx = parseInt((item as HTMLElement).dataset.index!);
    const cookie = filtered[idx];

    item.querySelector('.btn-edit')!.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditor(cookie);
    });
    item.querySelector('.btn-copy')!.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(cookie.value);
      toast('Copied to clipboard');
    });
    item.querySelector('.btn-delete')!.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteCookie(cookie);
    });
    item.addEventListener('click', () => openEditor(cookie));
  });
}

async function deleteCookie(cookie: CookieLike) {
  const url = cookieUrl(cookie);
  await browser.runtime.sendMessage({ action: 'deleteCookie', name: cookie.name, url, storeId: cookie.storeId });
  toast(`Deleted "${cookie.name}"`);
  loadCookies();
}

// Actions

function setupActions() {
  document.getElementById('btn-add')!.addEventListener('click', () => openEditor(null));

  document.getElementById('btn-delete-all')!.addEventListener('click', async () => {
    if (allCookies.length === 0) return;
    const response = await browser.runtime.sendMessage({ action: 'deleteAllCookies', url: currentUrl });
    toast(`Deleted ${(response as { deleted: number }).deleted} cookies`);
    loadCookies();
  });

  document.getElementById('btn-theme')!.addEventListener('click', async () => {
    const isDark = document.body.classList.contains('dark');
    const newTheme = isDark ? 'light' : 'dark';
    browser.storage.local.set({ theme: newTheme });
    applyTheme(newTheme);
  });

  document.getElementById('btn-settings')!.addEventListener('click', () => {
    browser.runtime.openOptionsPage();
  });
}

// Cookie editor

function setupEditor() {
  document.getElementById('btn-editor-cancel')!.addEventListener('click', closeEditor);
  document.getElementById('btn-editor-save')!.addEventListener('click', saveEditor);

  document.getElementById('cookie-editor')!.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'cookie-editor') closeEditor();
  });

  document.getElementById('edit-session')!.addEventListener('change', (e) => {
    (document.getElementById('edit-expires') as HTMLInputElement).disabled =
      (e.target as HTMLInputElement).checked;
  });
}

function openEditor(cookie: CookieLike | null) {
  editingCookie = cookie;
  const modal = document.getElementById('cookie-editor')!;
  const title = document.getElementById('editor-title')!;

  if (cookie) {
    title.textContent = 'Edit Cookie';
    (document.getElementById('edit-name') as HTMLInputElement).value = cookie.name;
    (document.getElementById('edit-value') as HTMLInputElement).value = cookie.value;
    (document.getElementById('edit-domain') as HTMLInputElement).value = cookie.domain;
    (document.getElementById('edit-path') as HTMLInputElement).value = cookie.path;
    (document.getElementById('edit-secure') as HTMLInputElement).checked = cookie.secure;
    (document.getElementById('edit-httponly') as HTMLInputElement).checked = cookie.httpOnly;
    (document.getElementById('edit-session') as HTMLInputElement).checked = !!cookie.session;
    (document.getElementById('edit-samesite') as HTMLSelectElement).value = cookie.sameSite || 'unspecified';

    const expiresInput = document.getElementById('edit-expires') as HTMLInputElement;
    if (cookie.expirationDate) {
      const d = new Date(cookie.expirationDate * 1000);
      expiresInput.value = d.toISOString().slice(0, 16);
    } else {
      expiresInput.value = '';
    }
    expiresInput.disabled = !!cookie.session;
  } else {
    title.textContent = 'Add Cookie';
    (document.getElementById('edit-name') as HTMLInputElement).value = '';
    (document.getElementById('edit-value') as HTMLInputElement).value = '';
    (document.getElementById('edit-domain') as HTMLInputElement).value = currentDomain ? '.' + currentDomain : '';
    (document.getElementById('edit-path') as HTMLInputElement).value = '/';
    (document.getElementById('edit-secure') as HTMLInputElement).checked = false;
    (document.getElementById('edit-httponly') as HTMLInputElement).checked = false;
    (document.getElementById('edit-session') as HTMLInputElement).checked = true;
    (document.getElementById('edit-samesite') as HTMLSelectElement).value = 'lax';
    (document.getElementById('edit-expires') as HTMLInputElement).value = '';
    (document.getElementById('edit-expires') as HTMLInputElement).disabled = true;
  }

  modal.style.display = 'flex';
  (document.getElementById('edit-name') as HTMLInputElement).focus();
}

function closeEditor() {
  document.getElementById('cookie-editor')!.style.display = 'none';
  editingCookie = null;
}

async function saveEditor() {
  const name = (document.getElementById('edit-name') as HTMLInputElement).value.trim();
  const value = (document.getElementById('edit-value') as HTMLInputElement).value;
  const domain = (document.getElementById('edit-domain') as HTMLInputElement).value.trim();
  const path = (document.getElementById('edit-path') as HTMLInputElement).value.trim() || '/';
  const secure = (document.getElementById('edit-secure') as HTMLInputElement).checked;
  const httpOnly = (document.getElementById('edit-httponly') as HTMLInputElement).checked;
  const session = (document.getElementById('edit-session') as HTMLInputElement).checked;
  const sameSite = (document.getElementById('edit-samesite') as HTMLSelectElement).value;

  if (!name) { toast('Cookie name is required'); return; }
  if (!domain) { toast('Domain is required'); return; }

  if (editingCookie) {
    const url = cookieUrl(editingCookie);
    await browser.runtime.sendMessage({ action: 'deleteCookie', name: editingCookie.name, url });
  }

  let expirationDate: number | null = null;
  if (!session) {
    const expiresVal = (document.getElementById('edit-expires') as HTMLInputElement).value;
    if (expiresVal) {
      expirationDate = new Date(expiresVal).getTime() / 1000;
    } else {
      expirationDate = Date.now() / 1000 + 365 * 24 * 60 * 60;
    }
  }

  const response = await browser.runtime.sendMessage({
    action: 'setCookie',
    cookie: { name, value, domain, path, secure, httpOnly, session, sameSite, expirationDate },
  });

  if ((response as { error?: string }).error) {
    toast('Error: ' + (response as { error: string }).error);
  } else {
    toast(editingCookie ? 'Cookie updated' : 'Cookie added');
    closeEditor();
    loadCookies();
  }
}

// Export menu

function setupExportMenu() {
  const btn = document.getElementById('btn-export')!;
  const menu = document.getElementById('export-menu')!;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = btn.getBoundingClientRect();
    (menu as HTMLElement).style.top = rect.bottom + 2 + 'px';
    (menu as HTMLElement).style.right = (document.body.clientWidth - rect.right) + 'px';
    (menu as HTMLElement).style.display = (menu as HTMLElement).style.display === 'none' ? 'block' : 'none';
  });

  document.addEventListener('click', () => {
    (menu as HTMLElement).style.display = 'none';
  });

  menu.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const format = (btn as HTMLElement).dataset.format;
      const response = await browser.runtime.sendMessage({
        action: 'exportCookies',
        url: currentUrl,
        format,
      });
      await navigator.clipboard.writeText((response as { result: string }).result);
      toast(`Copied ${format!.toUpperCase()} to clipboard`);
      (menu as HTMLElement).style.display = 'none';
    });
  });
}

// Monitor

async function loadChangeLog() {
  const response = await browser.runtime.sendMessage({ action: 'getChangeLog' });
  const log = ((response as { changeLog: unknown[] }).changeLog || []) as Array<{
    timestamp: number;
    removed: boolean;
    cookie: { name: string; domain: string };
    cause: string;
  }>;
  const container = document.getElementById('change-log')!;
  const empty = document.getElementById('monitor-empty')!;

  if (log.length === 0) {
    container.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  container.innerHTML = log.map((entry) => {
    const isRemoved = entry.removed;
    const iconClass = isRemoved ? 'removed' : 'added';
    const icon = isRemoved ? '−' : '+';
    const cause = CAUSE_MAP[entry.cause] || entry.cause;

    return `
      <div class="change-entry">
        <span class="change-icon ${iconClass}">${icon}</span>
        <div class="change-details">
          <span class="change-name">${escapeHtml(entry.cookie.name)}</span>
          <span class="change-cause">${escapeHtml(entry.cookie.domain)} — ${cause}</span>
        </div>
        <span class="change-time">${formatTime(entry.timestamp)}</span>
      </div>
    `;
  }).join('');

  document.getElementById('btn-clear-log')!.onclick = async () => {
    await browser.runtime.sendMessage({ action: 'clearChangeLog' });
    loadChangeLog();
  };
}

// Profiles

function setupProfiles() {
  document.getElementById('btn-save-profile')!.addEventListener('click', async () => {
    const name = (document.getElementById('profile-name') as HTMLInputElement).value.trim();
    if (!name) { toast('Enter a profile name'); return; }
    const response = await browser.runtime.sendMessage({
      action: 'saveProfile',
      name,
      url: currentUrl,
    });
    toast(`Saved "${name}" (${(response as { count: number }).count} cookies)`);
    (document.getElementById('profile-name') as HTMLInputElement).value = '';
    loadProfiles();
  });
}

async function loadProfiles() {
  const response = await browser.runtime.sendMessage({ action: 'getProfiles' });
  const profiles = ((response as { profiles: Record<string, { savedAt: number; count: number }> }).profiles) || {};
  const names = Object.keys(profiles);
  const container = document.getElementById('profile-list')!;
  const empty = document.getElementById('profiles-empty')!;

  if (names.length === 0) {
    container.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  container.innerHTML = names.map((name) => {
    const p = profiles[name];
    const date = formatTime(p.savedAt);
    return `
      <div class="profile-item" data-name="${escapeHtml(name)}">
        <span class="profile-name">${escapeHtml(name)}</span>
        <span class="profile-meta">${p.count} cookies · ${date}</span>
        <span class="profile-actions">
          <button class="action-btn btn-load-profile">Load</button>
          <button class="action-btn danger btn-delete-profile">&#10005;</button>
        </span>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.profile-item').forEach((item) => {
    const name = (item as HTMLElement).dataset.name!;
    item.querySelector('.btn-load-profile')!.addEventListener('click', async () => {
      const response = await browser.runtime.sendMessage({ action: 'loadProfile', name, clearFirst: true });
      const res = response as { error?: string; restored?: number };
      if (res.error) {
        toast('Error: ' + res.error);
      } else {
        toast(`Loaded "${name}" (${res.restored} cookies)`);
        loadCookies();
      }
    });
    item.querySelector('.btn-delete-profile')!.addEventListener('click', async () => {
      await browser.runtime.sendMessage({ action: 'deleteProfile', name });
      toast(`Deleted profile "${name}"`);
      loadProfiles();
    });
  });
}
