import {
  escapeHtml, formatTime, CAUSE_MAP, cookieBadges, cookieHost, filterCookies,
  toDatetimeLocal, fromDatetimeLocal, isPartitioned,
} from '@/utils/cookies';
import type { CookieLike } from '@/utils/cookies';
import { isHostOnly } from '@/utils/writes';
import {
  validateCookie, hasErrors, needsConfirmation, cookieSize, MAX_NAME_VALUE_BYTES, SIZE_WARNING_BYTES,
} from '@/utils/validate';
import type { CookieDraft, Field, Issue } from '@/utils/validate';
import { DEFAULT_MONITOR, DEFAULT_MAX_LOG, normalizeMonitorSettings, clampMaxLog } from '@/utils/monitor';
import type { MonitorSettings } from '@/utils/monitor';
import './style.css';

interface Failure { name: string; error: string }
interface RemoveResult { removed: CookieLike[]; failed: Failure[] }
interface WriteReport { written: CookieLike[]; expired: string[]; failed: Failure[] }
interface UpdateResult { cookie?: CookieLike | null; deleted?: boolean; warning?: string; error?: string }
interface LoadProfileResult extends WriteReport { previous: CookieLike[]; error?: string }
interface ChangeEntry { timestamp: number; removed: boolean; cause: string; cookie: CookieLike }

const UNDO_MS = 10_000;
const YEAR_SECONDS = 365 * 24 * 60 * 60;

let currentUrl = '';
let currentDomain = '';
let currentIsHttps = false;
let allCookies: CookieLike[] = [];
let editingCookie: CookieLike | null = null;
let editorInitialExpires = '';
let editorSubmitted = false;
let confirmArmed = false;
let monitorSettings: MonitorSettings = DEFAULT_MONITOR;
let maxLog = DEFAULT_MAX_LOG;

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => el<HTMLInputElement>(id);

function send<T>(message: Record<string, unknown>): Promise<T> {
  return browser.runtime.sendMessage(message) as Promise<T>;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const data = await browser.storage.local.get({ theme: 'auto' });
  applyTheme(data.theme as string);
  el('version').textContent = `v${browser.runtime.getManifest().version}`;

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) {
    try {
      const url = new URL(tab.url);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        currentUrl = url.origin + url.pathname;
        currentDomain = url.hostname;
        currentIsHttps = url.protocol === 'https:';
      }
    } catch {
      currentDomain = '';
    }
  }

  setupTabs();
  setupSearch();
  setupActions();
  setupEditor();
  setupExportMenu();
  setupMonitor();
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

interface ToastOptions {
  actionLabel?: string;
  onAction?: () => void;
  error?: boolean;
}

let toastTimer: number | undefined;

function toast(message: string, opts: ToastOptions = {}) {
  const region = el('toast-region');
  region.replaceChildren();
  window.clearTimeout(toastTimer);

  const box = document.createElement('div');
  box.className = 'toast' + (opts.onAction ? ' toast-action' : '') + (opts.error ? ' toast-error' : '');
  const text = document.createElement('span');
  text.textContent = message;
  box.appendChild(text);
  if (opts.onAction) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = opts.actionLabel || 'Undo';
    button.addEventListener('click', () => {
      box.remove();
      window.clearTimeout(toastTimer);
      opts.onAction!();
    });
    box.appendChild(button);
  }
  region.appendChild(box);
  toastTimer = window.setTimeout(() => box.remove(), opts.onAction ? UNDO_MS : opts.error ? 5000 : 2100);
}

function describeWrite(verb: string, report: WriteReport): string {
  const parts = [`${verb} ${plural(report.written.length, 'cookie')}`];
  if (report.expired.length) parts.push(`${report.expired.length} expired, skipped`);
  if (report.failed.length) parts.push(`${report.failed.length} failed (${report.failed.map((f) => f.name).join(', ')})`);
  return parts.join(' · ');
}

function confirmDialog(message: string, detail: string, okLabel: string): Promise<boolean> {
  const dialog = el<HTMLDialogElement>('confirm-dialog');
  el('confirm-message').textContent = message;
  el('confirm-detail').textContent = detail;
  el('btn-confirm-ok').textContent = okLabel;
  dialog.returnValue = '';
  dialog.showModal();
  el('btn-confirm-cancel').focus();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
  });
}

// Tab navigation

function isTabActive(name: string): boolean {
  return el('tab-' + name).classList.contains('active');
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((tc) => tc.classList.remove('active'));
      tab.classList.add('active');
      const tabName = (tab as HTMLElement).dataset.tab;
      el('tab-' + tabName).classList.add('active');

      if (tabName === 'monitor') loadChangeLog();
      if (tabName === 'profiles') loadProfiles();
    });
  });
}

// Cookie list

function setupSearch() {
  el('search').addEventListener('input', renderCookies);
}

async function loadCookies() {
  const domainInfo = el('domain-info');
  if (currentDomain) {
    domainInfo.textContent = currentDomain;
    const response = await send<{ cookies: CookieLike[] }>({ action: 'getCookies', url: currentUrl });
    allCookies = response.cookies || [];
  } else {
    domainInfo.textContent = 'No active page';
    allCookies = [];
  }
  renderCookies();
}

function renderCookies() {
  const list = el('cookie-list');
  const empty = el('cookie-empty');
  const filtered = filterCookies(allCookies, input('search').value);

  if (filtered.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    el('cookie-count').textContent = '0 cookies';
    return;
  }

  empty.style.display = 'none';
  el('cookie-count').textContent = plural(filtered.length, 'cookie');

  list.innerHTML = filtered.map((cookie, i) => {
    const badges = cookieBadges(cookie)
      .map((b) => `<span class="badge badge-${escapeHtml(b.kind)}" title="${escapeHtml(b.title)}">${escapeHtml(b.label)}</span>`)
      .join('');
    const name = escapeHtml(cookie.name);
    const label = name || '(no name)';

    return `
      <div class="cookie-item${isPartitioned(cookie) ? ' is-partitioned' : ''}" data-index="${i}">
        <span class="cookie-name" title="${name}">${label}</span>
        <span class="cookie-value" title="${escapeHtml(cookie.value)}">${escapeHtml(cookie.value)}</span>
        <span class="cookie-badges">${badges}</span>
        <span class="cookie-actions">
          <button class="btn-edit" title="Edit" aria-label="Edit ${label}">&#9998;</button>
          <button class="btn-copy" title="Copy value" aria-label="Copy value of ${label}">&#10697;</button>
          <button class="btn-delete" title="Delete" aria-label="Delete ${label}">&#10005;</button>
        </span>
      </div>
    `;
  }).join('');

  list.querySelectorAll<HTMLElement>('.cookie-item').forEach((item) => {
    const cookie = filtered[parseInt(item.dataset.index!, 10)]!;

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
  const res = await send<RemoveResult>({ action: 'removeCookies', cookies: [cookie] });
  await loadCookies();
  if (res.failed.length) {
    toast(`Couldn’t delete “${cookie.name}”: ${res.failed[0]!.error}`, { error: true });
    return;
  }
  toast(`Deleted “${cookie.name}”`, { actionLabel: 'Undo', onAction: () => undoRemoval(res.removed) });
}

async function undoRemoval(snapshot: CookieLike[]) {
  const report = await send<WriteReport>({ action: 'restoreCookies', cookies: snapshot });
  await loadCookies();
  toast(describeWrite('Restored', report), { error: report.failed.length > 0 });
}

// Actions

function setupActions() {
  el('btn-add').addEventListener('click', () => openEditor(null));

  el('btn-delete-all').addEventListener('click', async () => {
    if (allCookies.length === 0) {
      toast('No cookies to delete');
      return;
    }
    const snapshot = allCookies.slice();
    const n = snapshot.length;
    const ok = await confirmDialog(
      `Delete all ${plural(n, 'cookie')} for ${currentDomain}?`,
      'Sites that rely on them will sign you out or forget settings. You can undo for 10 seconds.',
      `Delete ${n}`,
    );
    if (!ok) return;
    const res = await send<RemoveResult>({ action: 'removeCookies', cookies: snapshot });
    await loadCookies();
    const message = res.failed.length
      ? `Deleted ${res.removed.length} of ${n} · ${res.failed.length} failed`
      : `Deleted ${plural(res.removed.length, 'cookie')}`;
    toast(message, { actionLabel: 'Undo', onAction: () => undoRemoval(res.removed) });
  });

  el('btn-theme').addEventListener('click', async () => {
    const isDark = document.body.classList.contains('dark');
    const newTheme = isDark ? 'light' : 'dark';
    browser.storage.local.set({ theme: newTheme });
    applyTheme(newTheme);
  });

  el('btn-settings').addEventListener('click', () => {
    browser.runtime.openOptionsPage();
  });
}

// Cookie editor

const EDITOR_FIELDS: Field[] = ['name', 'value', 'domain', 'path', 'expires', 'sameSite'];
const FIELD_CONTROL: Record<Field, string> = {
  name: 'edit-name',
  value: 'edit-value',
  domain: 'edit-domain',
  path: 'edit-path',
  expires: 'edit-expires',
  sameSite: 'edit-samesite',
};

function setupEditor() {
  const dialog = el<HTMLDialogElement>('cookie-editor');
  const form = el('editor-form');
  el('btn-editor-cancel').addEventListener('click', closeEditor);
  form.addEventListener('submit', saveEditor);
  form.addEventListener('input', onEditorChange);
  form.addEventListener('change', onEditorChange);
  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeEditor();
  });

  input('edit-session').addEventListener('change', () => {
    const expires = input('edit-expires');
    expires.disabled = input('edit-session').checked;
    if (!expires.disabled && !expires.value) expires.value = toDatetimeLocal(Date.now() / 1000 + YEAR_SECONDS);
  });
}

function onEditorChange() {
  confirmArmed = false;
  el('btn-editor-save').textContent = 'Save';
  el('editor-error').hidden = true;
  refreshValidation();
}

function openEditor(cookie: CookieLike | null) {
  editingCookie = cookie;
  editorSubmitted = false;
  confirmArmed = false;
  el('btn-editor-save').textContent = 'Save';
  el('editor-error').hidden = true;
  el('editor-title').textContent = cookie ? 'Edit Cookie' : 'Add Cookie';

  const expires = input('edit-expires');
  if (cookie) {
    input('edit-name').value = cookie.name;
    el<HTMLTextAreaElement>('edit-value').value = cookie.value;
    input('edit-domain').value = cookie.domain;
    input('edit-hostonly').checked = isHostOnly(cookie);
    input('edit-path').value = cookie.path;
    input('edit-secure').checked = cookie.secure;
    input('edit-httponly').checked = cookie.httpOnly;
    input('edit-session').checked = !!cookie.session;
    el<HTMLSelectElement>('edit-samesite').value = cookie.sameSite || 'unspecified';
    editorInitialExpires = cookie.expirationDate ? toDatetimeLocal(cookie.expirationDate) : '';
    expires.value = editorInitialExpires;
    expires.disabled = !!cookie.session;
  } else {
    input('edit-name').value = '';
    el<HTMLTextAreaElement>('edit-value').value = '';
    input('edit-domain').value = currentDomain;
    input('edit-hostonly').checked = true;
    input('edit-path').value = '/';
    input('edit-secure').checked = currentIsHttps;
    input('edit-httponly').checked = false;
    input('edit-session').checked = true;
    el<HTMLSelectElement>('edit-samesite').value = 'lax';
    editorInitialExpires = '';
    expires.value = '';
    expires.disabled = true;
  }

  const partition = el('edit-partition');
  const pk = cookie?.partitionKey;
  if (pk?.topLevelSite) {
    partition.textContent = `Partitioned (CHIPS) under ${pk.topLevelSite}` +
      (pk.hasCrossSiteAncestor ? ', set from a cross-site frame' : '') +
      '. Saving keeps it in the same partition.';
    partition.hidden = false;
  } else {
    partition.hidden = true;
  }

  refreshValidation();
  el<HTMLDialogElement>('cookie-editor').showModal();
  (cookie ? el('edit-value') : input('edit-name')).focus();
}

function closeEditor() {
  const dialog = el<HTMLDialogElement>('cookie-editor');
  if (dialog.open) dialog.close();
  editingCookie = null;
}

function readDraft(): CookieDraft {
  const session = input('edit-session').checked;
  const expiresValue = input('edit-expires').value;
  let expirationDate: number | null = null;
  if (!session) {
    // An untouched expiry keeps the original to the fraction of a second; the input only holds minutes.
    expirationDate = editingCookie?.expirationDate && expiresValue === editorInitialExpires
      ? editingCookie.expirationDate
      : fromDatetimeLocal(expiresValue);
  }
  return {
    name: input('edit-name').value,
    value: el<HTMLTextAreaElement>('edit-value').value,
    domain: input('edit-domain').value.trim(),
    hostOnly: input('edit-hostonly').checked,
    path: input('edit-path').value.trim() || '/',
    secure: input('edit-secure').checked,
    httpOnly: input('edit-httponly').checked,
    sameSite: el<HTMLSelectElement>('edit-samesite').value,
    session,
    expirationDate,
    partitioned: isPartitioned(editingCookie ?? {}),
  };
}

const SEVERITY_RANK = { warning: 1, confirm: 2, error: 3 } as const;

function refreshValidation(): Issue[] {
  const draft = readDraft();
  const issues = validateCookie(draft, {
    nowSeconds: Date.now() / 1000,
    allowEmptyName: editingCookie?.name === '',
  });

  for (const field of EDITOR_FIELDS) {
    // "Required" errors wait for a save attempt; everything else shows as you type.
    const own = issues.filter((i) => i.field === field && (editorSubmitted || i.code !== 'required'));
    const msg = el(`msg-${field}`);
    msg.textContent = own.map((i) => i.message).join(' ');
    const worst = own.reduce<Issue | null>((w, i) => (!w || SEVERITY_RANK[i.severity] > SEVERITY_RANK[w.severity] ? i : w), null);
    msg.className = 'field-msg' + (worst ? ` is-${worst.severity}` : '');
    el(FIELD_CONTROL[field]).setAttribute('aria-invalid', String(own.some((i) => i.severity === 'error')));
  }

  const size = cookieSize(draft.name, draft.value);
  const meter = el('edit-size');
  meter.textContent = `${size.toLocaleString()} / ${MAX_NAME_VALUE_BYTES.toLocaleString()} bytes`;
  meter.className = 'size-meter' + (size > MAX_NAME_VALUE_BYTES ? ' is-error' : size > SIZE_WARNING_BYTES ? ' is-warning' : '');
  return issues;
}

async function saveEditor(e: Event) {
  e.preventDefault();
  editorSubmitted = true;
  const issues = refreshValidation();
  const saveBtn = el<HTMLButtonElement>('btn-editor-save');

  if (hasErrors(issues)) {
    const first = issues.find((i) => i.severity === 'error')!;
    el(FIELD_CONTROL[first.field]).focus();
    return;
  }
  if (needsConfirmation(issues) && !confirmArmed) {
    confirmArmed = true;
    saveBtn.textContent = editingCookie ? 'Save and delete cookie' : 'Save anyway';
    return;
  }

  const draft = readDraft();
  const original = editingCookie;
  const cookie: CookieLike = {
    name: draft.name,
    value: draft.value,
    domain: draft.hostOnly ? cookieHost(draft.domain) : draft.domain,
    path: draft.path,
    secure: draft.secure,
    httpOnly: draft.httpOnly,
    sameSite: draft.sameSite,
    session: draft.session,
    expirationDate: draft.session ? null : draft.expirationDate,
    hostOnly: draft.hostOnly,
    storeId: original?.storeId,
    partitionKey: original?.partitionKey ?? null,
  };

  saveBtn.disabled = true;
  let res: UpdateResult;
  try {
    res = await send<UpdateResult>({ action: 'updateCookie', original, cookie });
  } catch (err) {
    res = { error: (err as Error).message };
  } finally {
    saveBtn.disabled = false;
  }

  if (res.error) {
    const box = el('editor-error');
    box.textContent = `The browser rejected this cookie: ${res.error} ` +
      (original ? 'The original cookie is unchanged.' : 'Nothing was added.');
    box.hidden = false;
    confirmArmed = false;
    saveBtn.textContent = 'Save';
    return;
  }

  closeEditor();
  toast(res.warning ?? (res.deleted
    ? `Deleted “${cookie.name}” (expiry in the past)`
    : original ? 'Cookie updated' : 'Cookie added'), { error: !!res.warning });
  loadCookies();
}

// Export menu

function setupExportMenu() {
  const btn = el('btn-export');
  const menu = el('export-menu');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = btn.getBoundingClientRect();
    menu.style.top = rect.bottom + 2 + 'px';
    menu.style.right = (document.body.clientWidth - rect.right) + 'px';
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  });

  document.addEventListener('click', () => {
    menu.style.display = 'none';
  });

  menu.querySelectorAll<HTMLElement>('button').forEach((item) => {
    item.addEventListener('click', async () => {
      const format = item.dataset.format!;
      const response = await send<{ result: string }>({
        action: 'exportCookies',
        url: currentUrl,
        format,
      });
      await navigator.clipboard.writeText(response.result);
      toast(`Copied ${format.toUpperCase()} to clipboard`);
      menu.style.display = 'none';
    });
  });
}

// Monitor

function setupMonitor() {
  input('monitor-record').addEventListener('change', () => {
    saveMonitorSettings({ ...monitorSettings, recording: input('monitor-record').checked });
  });

  el<HTMLSelectElement>('monitor-scope').addEventListener('change', (e) => {
    const value = (e.target as HTMLSelectElement).value;
    saveMonitorSettings(value.startsWith('site:')
      ? { ...monitorSettings, scope: 'site', site: value.slice(5) }
      : { ...monitorSettings, scope: 'all' });
  });

  el('btn-clear-log').addEventListener('click', async () => {
    await send({ action: 'clearChangeLog' });
    renderChangeLog([]);
    toast('Log cleared');
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.monitor) {
      monitorSettings = normalizeMonitorSettings(changes.monitor.newValue);
      renderMonitorControls();
    }
    if (changes.changeLog && isTabActive('monitor')) {
      renderChangeLog((changes.changeLog.newValue as ChangeEntry[]) || []);
    }
  });
}

async function saveMonitorSettings(next: MonitorSettings) {
  monitorSettings = normalizeMonitorSettings(next);
  renderMonitorControls();
  await browser.storage.local.set({ monitor: monitorSettings });
}

function renderMonitorControls() {
  const { recording, scope, site } = monitorSettings;
  input('monitor-record').checked = recording;

  const options = [{ value: 'all', label: 'All sites' }];
  if (scope === 'site' && site && site !== currentDomain) options.push({ value: `site:${site}`, label: `Only ${site}` });
  if (currentDomain) options.push({ value: `site:${currentDomain}`, label: `Only ${currentDomain}` });
  const select = el<HTMLSelectElement>('monitor-scope');
  select.innerHTML = options
    .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
    .join('');
  select.value = scope === 'site' ? `site:${site}` : 'all';

  const status = el('monitor-status');
  status.textContent = recording ? '● Recording' : 'Off';
  status.classList.toggle('is-recording', recording);

  const what = 'each cookie change (name, value, domain, time) is kept in this browser’s extension storage — ' +
    `newest ${maxLog} — and never leaves your device.`;
  el('monitor-note').textContent = recording
    ? `While recording, ${what}`
    : `Recording is off, so nothing is logged. When on, ${what}`;
}

async function loadChangeLog() {
  const data = await browser.storage.local.get({ monitor: DEFAULT_MONITOR, maxLog: DEFAULT_MAX_LOG });
  monitorSettings = normalizeMonitorSettings(data.monitor);
  maxLog = clampMaxLog(data.maxLog);
  renderMonitorControls();
  const response = await send<{ changeLog: ChangeEntry[] }>({ action: 'getChangeLog' });
  renderChangeLog(response.changeLog || []);
}

function renderChangeLog(log: ChangeEntry[]) {
  const container = el('change-log');
  const empty = el('monitor-empty');

  if (log.length === 0) {
    container.innerHTML = '';
    empty.textContent = monitorSettings.recording
      ? 'Recording. Changes show up here as sites set, update and expire cookies.'
      : 'Nothing recorded. Turn on Record to log cookie changes as they happen.';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  container.innerHTML = log.map((entry) => {
    const isRemoved = entry.removed;
    const iconClass = isRemoved ? 'removed' : 'added';
    const icon = isRemoved ? '−' : '+';
    const cause = CAUSE_MAP[entry.cause] || entry.cause;
    const value = entry.cookie.value ?? '';

    return `
      <div class="change-entry">
        <span class="change-icon ${iconClass}" aria-label="${isRemoved ? 'Removed' : 'Set'}">${icon}</span>
        <div class="change-details">
          <span class="change-name">${escapeHtml(entry.cookie.name)}</span>
          <span class="change-cause">${escapeHtml(entry.cookie.domain)} — ${escapeHtml(cause)}</span>
          ${value ? `<span class="change-value" title="${escapeHtml(value)}">${escapeHtml(value)}</span>` : ''}
        </div>
        <span class="change-time">${formatTime(entry.timestamp)}</span>
      </div>
    `;
  }).join('');
}

// Profiles

function setupProfiles() {
  el('btn-save-profile').addEventListener('click', async () => {
    const name = input('profile-name').value.trim();
    if (!name) { toast('Enter a profile name'); return; }
    const response = await send<{ count: number }>({
      action: 'saveProfile',
      name,
      url: currentUrl,
    });
    toast(`Saved “${name}” (${plural(response.count, 'cookie')})`);
    input('profile-name').value = '';
    loadProfiles();
  });
}

async function loadProfiles() {
  const response = await send<{ profiles: Record<string, { savedAt: number; count: number }> }>({ action: 'getProfiles' });
  const profiles = response.profiles || {};
  const names = Object.keys(profiles);
  const container = el('profile-list');
  const empty = el('profiles-empty');

  if (names.length === 0) {
    container.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  container.innerHTML = names.map((name) => {
    const p = profiles[name]!;
    const date = formatTime(p.savedAt);
    const safe = escapeHtml(name);
    return `
      <div class="profile-item" data-name="${safe}">
        <span class="profile-name">${safe}</span>
        <span class="profile-meta">${plural(p.count, 'cookie')} · ${date}</span>
        <span class="profile-actions">
          <button class="action-btn btn-load-profile" aria-label="Load profile ${safe}">Load</button>
          <button class="action-btn danger btn-delete-profile" title="Delete profile" aria-label="Delete profile ${safe}">&#10005;</button>
        </span>
      </div>
    `;
  }).join('');

  container.querySelectorAll<HTMLElement>('.profile-item').forEach((item) => {
    const name = item.dataset.name!;
    item.querySelector('.btn-load-profile')!.addEventListener('click', async () => {
      const res = await send<LoadProfileResult>({ action: 'loadProfile', name, clearFirst: true });
      if (res.error) {
        toast('Error: ' + res.error, { error: true });
        return;
      }
      await loadCookies();
      toast(describeWrite(`Loaded “${name}”:`, res), {
        actionLabel: 'Undo',
        onAction: async () => {
          await send<RemoveResult>({ action: 'removeCookies', cookies: res.written });
          const report = await send<WriteReport>({ action: 'restoreCookies', cookies: res.previous });
          await loadCookies();
          toast(describeWrite('Undone — restored', report), { error: report.failed.length > 0 });
        },
      });
    });
    item.querySelector('.btn-delete-profile')!.addEventListener('click', async () => {
      const ok = await confirmDialog(`Delete profile “${name}”?`, 'The saved cookies in it are removed from this browser.', 'Delete');
      if (!ok) return;
      await send({ action: 'deleteProfile', name });
      toast(`Deleted profile “${name}”`);
      loadProfiles();
    });
  });
}
