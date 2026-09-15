import {
  escapeHtml, formatTime, CAUSE_MAP, cookieBadges, cookieHost, filterCookies,
  toDatetimeLocal, fromDatetimeLocal, isPartitioned,
} from '@/utils/cookies';
import type { CookieLike } from '@/utils/cookies';
import { isHostOnly, cookieIdentity } from '@/utils/writes';
import {
  validateCookie, hasErrors, needsConfirmation, cookieSize, MAX_NAME_VALUE_BYTES, SIZE_WARNING_BYTES,
} from '@/utils/validate';
import type { CookieDraft, Field, Issue } from '@/utils/validate';
import { DEFAULT_MONITOR, DEFAULT_MAX_LOG, normalizeMonitorSettings, clampMaxLog } from '@/utils/monitor';
import type { MonitorSettings } from '@/utils/monitor';
import {
  sortCookies, applyChips, chipCounts, shortExpiry, expiryLabel, formatBytes, cookieStats,
  CHIPS, CHIP_LABELS, MAX_COOKIES_PER_DOMAIN,
} from '@/utils/list';
import type { Chip, SortKey } from '@/utils/list';
import { EXPORT_FORMATS, formatExport, exportFilename } from '@/utils/export';
import type { ExportFormat } from '@/utils/export';
import type { RemoveResult, WriteReport, UpdateResult, LoadProfileResult, ChangeEntry } from '@/utils/messages';
import {
  el, input, send, plural, toast, describeWrite, confirmDialog, copyText, downloadText,
} from '@/ui/dom';
import { renderInspector } from '@/ui/inspector';
import { setupImportDialog, openImportDialog } from '@/ui/import-dialog';
import './style.css';

const YEAR_SECONDS = 365 * 24 * 60 * 60;
const SORT_KEYS: SortKey[] = ['name', 'domain', 'expiry', 'size'];
const params = new URLSearchParams(location.search);

let currentUrl = '';
let currentDomain = '';
let currentIsHttps = false;
let allCookies: CookieLike[] = [];
let shownCookies: CookieLike[] = [];
const selected = new Set<string>();
const activeChips = new Set<Chip>();
let sortKey: SortKey = 'name';
let sortDir: 'asc' | 'desc' = 'asc';
let editingCookie: CookieLike | null = null;
let editorInitialExpires = '';
let editorSubmitted = false;
let confirmArmed = false;
let monitorSettings: MonitorSettings = DEFAULT_MONITOR;
let maxLog = DEFAULT_MAX_LOG;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const data = await browser.storage.local.get({ theme: 'auto', listSort: { key: 'name', dir: 'asc' } });
  applyTheme(data.theme as string);
  const savedSort = (data.listSort || {}) as { key?: string; dir?: string };
  if (SORT_KEYS.includes(savedSort.key as SortKey)) sortKey = savedSort.key as SortKey;
  sortDir = savedSort.dir === 'desc' ? 'desc' : 'asc';
  el('version').textContent = `v${browser.runtime.getManifest().version}`;

  // Opened as a tab (to pick an import file, say), the page to work on arrives as ?url=.
  const pageUrl = params.get('url');
  if (pageUrl) document.body.classList.add('page-mode');
  const targetUrl = pageUrl ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.url;
  if (targetUrl) {
    try {
      const url = new URL(targetUrl);
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
  setupListControls();
  setupActions();
  setupEditor();
  setupExportMenu();
  setupMonitor();
  setupProfiles();
  setupImportDialog({
    url: () => currentUrl,
    existing: () => allCookies,
    onApplied: () => { void loadCookies(); },
    openInTab: pageUrl || !currentUrl ? undefined : () => {
      void browser.tabs.create({
        url: `${browser.runtime.getURL('/popup.html')}?url=${encodeURIComponent(currentUrl)}&view=import`,
      });
      window.close();
    },
  });
  await loadCookies();
  if (params.get('view') === 'import') openImportDialog();
}

function applyTheme(theme: string) {
  if (theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.body.classList.add('dark');
  } else {
    document.body.classList.remove('dark');
  }
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

function setupListControls() {
  const sortSelect = el<HTMLSelectElement>('sort-key');
  sortSelect.value = sortKey;
  renderSortDirection();
  sortSelect.addEventListener('change', () => {
    sortKey = sortSelect.value as SortKey;
    saveSort();
    renderCookies();
  });
  el('btn-sort-dir').addEventListener('click', () => {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    renderSortDirection();
    saveSort();
    renderCookies();
  });

  const chipBar = el('chip-bar');
  chipBar.innerHTML = CHIPS.map((chip) =>
    `<button type="button" class="chip" data-chip="${chip}" aria-pressed="false">${escapeHtml(CHIP_LABELS[chip])} <span class="chip-count"></span></button>`,
  ).join('');
  chipBar.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-chip]');
    if (!button) return;
    const chip = button.dataset.chip as Chip;
    if (activeChips.has(chip)) activeChips.delete(chip);
    else activeChips.add(chip);
    renderCookies();
  });

  input('select-all').addEventListener('change', () => {
    const on = input('select-all').checked;
    for (const c of shownCookies) {
      const id = cookieIdentity(c);
      if (on) selected.add(id);
      else selected.delete(id);
    }
    renderCookies();
  });
  el('btn-delete-selected').addEventListener('click', deleteSelected);
  el('btn-clear-selection').addEventListener('click', () => {
    selected.clear();
    renderCookies();
  });
}

function renderSortDirection() {
  const button = el('btn-sort-dir');
  const asc = sortDir === 'asc';
  button.textContent = asc ? '↑' : '↓';
  button.title = asc ? 'Ascending' : 'Descending';
  button.setAttribute('aria-label', `Sort direction: ${asc ? 'ascending' : 'descending'}`);
}

function saveSort() {
  void browser.storage.local.set({ listSort: { key: sortKey, dir: sortDir } });
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

function renderChips(pool: CookieLike[]) {
  const counts = chipCounts(pool);
  el('chip-bar').querySelectorAll<HTMLButtonElement>('[data-chip]').forEach((button) => {
    const chip = button.dataset.chip as Chip;
    const on = activeChips.has(chip);
    button.setAttribute('aria-pressed', String(on));
    button.disabled = !on && counts[chip] === 0;
    button.querySelector('.chip-count')!.textContent = String(counts[chip]);
  });
}

function renderStats() {
  const stats = cookieStats(allCookies);
  const box = el('list-stats');
  if (stats.count === 0) {
    box.textContent = '';
    box.title = '';
    return;
  }
  const crowded = stats.crowdedDomains.length
    ? ` · over ${MAX_COOKIES_PER_DOMAIN} on ${stats.crowdedDomains.join(', ')}`
    : '';
  box.textContent = `${formatBytes(stats.totalBytes)} total${crowded}`;
  box.classList.toggle('is-warning', crowded !== '');
  box.title = `Largest: ${stats.largest!.name || '(no name)'}, ${stats.largest!.bytes} bytes. ` +
    `Browsers reject a cookie over ${MAX_NAME_VALUE_BYTES} bytes and keep at most ${MAX_COOKIES_PER_DOMAIN} per domain.`;
}

function renderSelection() {
  // Forget selections of cookies that are gone.
  const present = new Set(allCookies.map((c) => cookieIdentity(c)));
  for (const id of [...selected]) if (!present.has(id)) selected.delete(id);

  el('selection-info').hidden = selected.size === 0;
  el('selection-count').textContent = `${selected.size} selected`;

  const shownIds = shownCookies.map((c) => cookieIdentity(c));
  const selectedShown = shownIds.filter((id) => selected.has(id)).length;
  const all = input('select-all');
  all.disabled = shownIds.length === 0;
  all.checked = shownIds.length > 0 && selectedShown === shownIds.length;
  all.indeterminate = selectedShown > 0 && selectedShown < shownIds.length;
}

function renderCookies() {
  const list = el('cookie-list');
  const empty = el('cookie-empty');
  const now = Date.now() / 1000;
  const searched = filterCookies(allCookies, input('search').value);
  shownCookies = sortCookies(applyChips(searched, activeChips), sortKey, sortDir);

  renderChips(searched);
  renderStats();
  renderSelection();
  el('cookie-count').textContent = shownCookies.length === allCookies.length
    ? plural(allCookies.length, 'cookie')
    : `${shownCookies.length} of ${plural(allCookies.length, 'cookie')}`;

  if (shownCookies.length === 0) {
    list.innerHTML = '';
    empty.textContent = allCookies.length ? 'No cookies match the filter.' : 'No cookies found for this site.';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  list.innerHTML = shownCookies.map((cookie, i) => {
    const isSelected = selected.has(cookieIdentity(cookie));
    const bytes = cookieSize(cookie.name, cookie.value);
    const badges = cookieBadges(cookie)
      .map((b) => `<span class="badge badge-${escapeHtml(b.kind)}" title="${escapeHtml(b.title)}">${escapeHtml(b.label)}</span>`)
      .join('');
    const name = escapeHtml(cookie.name);
    const label = name || '(no name)';
    const expiry = cookie.session || !cookie.expirationDate
      ? 'Session cookie — removed when the browser closes'
      : `Expires ${new Date(cookie.expirationDate * 1000).toLocaleString()} (${expiryLabel(cookie, now)})`;

    return `
      <div class="cookie-item${isSelected ? ' is-selected' : ''}${isPartitioned(cookie) ? ' is-partitioned' : ''}" data-index="${i}">
        <input type="checkbox" class="row-select" aria-label="Select ${label}"${isSelected ? ' checked' : ''}>
        <span class="cookie-name" title="${name}">${label}</span>
        <span class="cookie-value" title="${escapeHtml(cookie.value)}">${escapeHtml(cookie.value)}</span>
        <span class="cookie-meta${bytes > SIZE_WARNING_BYTES ? ' is-large' : ''}" title="${escapeHtml(`${expiry} · ${bytes} bytes`)}">${escapeHtml(shortExpiry(cookie, now))} · ${formatBytes(bytes)}</span>
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
    const cookie = shownCookies[parseInt(item.dataset.index!, 10)]!;
    const id = cookieIdentity(cookie);

    const box = item.querySelector<HTMLInputElement>('.row-select')!;
    box.addEventListener('click', (e) => e.stopPropagation());
    box.addEventListener('change', () => {
      if (box.checked) selected.add(id);
      else selected.delete(id);
      item.classList.toggle('is-selected', box.checked);
      renderSelection();
    });
    item.querySelector('.btn-edit')!.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditor(cookie);
    });
    item.querySelector('.btn-copy')!.addEventListener('click', async (e) => {
      e.stopPropagation();
      toast(await copyText(cookie.value) ? 'Copied to clipboard' : 'Copy failed', {});
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

async function deleteSelected() {
  const targets = allCookies.filter((c) => selected.has(cookieIdentity(c)));
  if (targets.length === 0) return;
  const n = targets.length;
  const ok = await confirmDialog(`Delete ${plural(n, 'selected cookie')}?`, 'You can undo for 10 seconds.', `Delete ${n}`);
  if (!ok) return;
  const res = await send<RemoveResult>({ action: 'removeCookies', cookies: targets });
  selected.clear();
  await loadCookies();
  const message = res.failed.length
    ? `Deleted ${res.removed.length} of ${n} · ${res.failed.length} failed`
    : `Deleted ${plural(res.removed.length, 'cookie')}`;
  toast(message, { actionLabel: 'Undo', onAction: () => undoRemoval(res.removed) });
}

async function undoRemoval(snapshot: CookieLike[]) {
  const report = await send<WriteReport>({ action: 'restoreCookies', cookies: snapshot });
  await loadCookies();
  toast(describeWrite('Restored', report), { error: report.failed.length > 0 });
}

// Actions

function setupActions() {
  el('btn-add').addEventListener('click', () => openEditor(null));
  el('btn-import').addEventListener('click', () => openImportDialog());

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

function onEditorChange(e: Event) {
  if ((e.target as HTMLElement).closest('#value-inspector')) return;
  confirmArmed = false;
  el('btn-editor-save').textContent = 'Save';
  el('editor-error').hidden = true;
  refreshValidation();
  if ((e.target as HTMLElement).id === 'edit-value') {
    renderInspector(el('value-inspector'), el<HTMLTextAreaElement>('edit-value').value);
  }
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
  renderInspector(el('value-inspector'), cookie?.value ?? '');
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

/** Selected cookies if any are selected, otherwise the cookies the list shows. */
function exportTargets(): { cookies: CookieLike[]; scope: string } {
  if (selected.size) {
    const cookies = allCookies.filter((c) => selected.has(cookieIdentity(c)));
    return { cookies, scope: plural(cookies.length, 'selected cookie') };
  }
  if (shownCookies.length !== allCookies.length) {
    return { cookies: shownCookies, scope: `the ${shownCookies.length} shown (of ${allCookies.length})` };
  }
  return { cookies: allCookies, scope: `all ${plural(allCookies.length, 'cookie')}` };
}

function setupExportMenu() {
  const btn = el('btn-export');
  const menu = el('export-menu');
  el('export-rows').innerHTML = EXPORT_FORMATS.map((f) => `
    <div class="export-row">
      <span>${escapeHtml(f.label)}</span>
      <button type="button" data-format="${f.id}" data-action="copy">Copy</button>
      <button type="button" data-format="${f.id}" data-action="download">Download</button>
    </div>`).join('');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = btn.getBoundingClientRect();
    menu.style.top = rect.bottom + 2 + 'px';
    menu.style.right = (document.body.clientWidth - rect.right) + 'px';
    el('export-scope').textContent = `Exporting ${exportTargets().scope}`;
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  });

  document.addEventListener('click', () => {
    menu.style.display = 'none';
  });

  menu.addEventListener('click', async (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-format]');
    if (!button) {
      e.stopPropagation();
      return;
    }
    const format = button.dataset.format as ExportFormat;
    const info = EXPORT_FORMATS.find((f) => f.id === format)!;
    const { cookies } = exportTargets();
    const text = formatExport(format, cookies, currentUrl);
    if (button.dataset.action === 'download') {
      downloadText(exportFilename(format, currentDomain, new Date()), text, info.mime);
      toast(`Downloaded ${info.label} · ${plural(cookies.length, 'cookie')}`);
    } else if (await copyText(text)) {
      toast(`Copied ${info.label} · ${plural(cookies.length, 'cookie')}`);
    } else {
      toast('Copy failed', { error: true });
    }
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
