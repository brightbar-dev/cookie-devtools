// The cookie UI, mounted by the popup, the side panel and the DevTools panel. Each surface only says
// which page to work on and when that page may have changed.
import {
  escapeHtml, formatTime, causeLabel, cookieBadges, cookieHost, filterCookies,
  toDatetimeLocal, fromDatetimeLocal, isPartitioned,
} from '@/utils/cookies';
import type { CookieLike } from '@/utils/cookies';
import { isHostOnly, cookieIdentity } from '@/utils/writes';
import {
  validateCookie, hasErrors, needsConfirmation, cookieSize, MAX_NAME_VALUE_BYTES, SIZE_WARNING_BYTES,
} from '@/utils/validate';
import type { CookieDraft, Field, Issue } from '@/utils/validate';
import {
  DEFAULT_MONITOR, DEFAULT_MAX_LOG, normalizeMonitorSettings, clampMaxLog, domainMatchesSite,
} from '@/utils/monitor';
import type { MonitorSettings } from '@/utils/monitor';
import {
  sortCookies, applyChips, chipCounts, shortExpiry, expiryLabel, formatBytes, cookieStats,
  CHIPS, chipLabel, MAX_COOKIES_PER_DOMAIN,
} from '@/utils/list';
import type { Chip, SortKey } from '@/utils/list';
import { EXPORT_FORMATS, exportFormatLabel, formatExport, exportFilename } from '@/utils/export';
import type { ExportFormat } from '@/utils/export';
import { parseTarget, noTargetReason, siteAccessPattern } from '@/utils/target';
import type { BlockRule, ProtectRule } from '@/utils/rules';
import type {
  RemoveResult, WriteReport, UpdateResult, LoadProfileResult, ChangeEntry, CookiesResult, BlockResult,
} from '@/utils/messages';
import { t, tp } from '@/utils/i18n';
import {
  el, input, send, localize, toast, describeWrite, confirmDialog, copyText, downloadText,
} from './dom';
import { renderInspector } from './inspector';
import { setupImportDialog, openImportDialog } from './import-dialog';
import { APP_MARKUP } from './markup';
import './app.css';

export type AppMode = 'popup' | 'page' | 'sidepanel' | 'devtools';

export interface AppHost {
  mode: AppMode;
  /** The URL of the page whose cookies to show; undefined when there is none. */
  currentUrl(): Promise<string | undefined>;
  /** Registers a callback for when that page may have changed (tab switch, navigation). */
  onTargetChanged?(listener: () => void): void;
}

const YEAR_SECONDS = 365 * 24 * 60 * 60;
const SORT_KEYS: SortKey[] = ['name', 'domain', 'expiry', 'size'];
const LIVE_MAX = 300;

let host: AppHost;
let rawTargetUrl: string | undefined;
let focusedRowId: string | null = null;
let currentUrl = '';
let currentDomain = '';
let currentIsHttps = false;
/** The user has limited this extension's site access in Chrome, and it does not include the current site. */
let siteAccessWithheld = false;
let allCookies: CookieLike[] = [];
let shownCookies: CookieLike[] = [];
let protectedIds = new Set<string>();
let protectedHere: ProtectRule[] = [];
let blockedHere: BlockRule[] = [];
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
let monitorView: 'live' | 'saved' = 'saved';
const liveEntries: ChangeEntry[] = [];

export async function mountApp(root: HTMLElement, appHost: AppHost) {
  host = appHost;
  root.innerHTML = APP_MARKUP;
  localize(document);
  document.body.classList.add(`mode-${host.mode}`);
  // The side panel and DevTools panel stay open, so they start on the live feed; the popup starts on
  // the saved log.
  monitorView = host.mode === 'sidepanel' || host.mode === 'devtools' ? 'live' : 'saved';

  const data = await browser.storage.local.get({ theme: 'auto', listSort: { key: 'name', dir: 'asc' } });
  applyTheme(data.theme as string);
  const savedSort = (data.listSort || {}) as { key?: string; dir?: string };
  if (SORT_KEYS.includes(savedSort.key as SortKey)) sortKey = savedSort.key as SortKey;
  sortDir = savedSort.dir === 'desc' ? 'desc' : 'asc';
  el('version').textContent = t('versionLabel', browser.runtime.getManifest().version);

  await refreshTarget();

  setupTabs();
  setupSearch();
  setupListControls();
  setupActions();
  setupEditor();
  setupExportMenu();
  setupMonitor();
  setupProfiles();
  setupRules();
  setupKeyboard();
  setupSidePanelButton();
  setupLiveUpdates();
  setupImportDialog({
    url: () => currentUrl,
    existing: () => allCookies,
    onApplied: () => { void loadCookies(); },
    // A file picker can close the popup; a tab keeps it.
    openInTab: host.mode === 'popup' ? () => {
      void browser.tabs.create({
        url: `${browser.runtime.getURL('/popup.html')}?url=${encodeURIComponent(currentUrl)}&view=import`,
      });
      window.close();
    } : undefined,
  });
  await loadCookies();
  if (new URLSearchParams(location.search).get('view') === 'import') openImportDialog();
}

function applyTheme(theme: string) {
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.body.classList.toggle('dark', theme === 'dark' || (theme === 'auto' && systemDark));
}

/** Re-reads the page to work on; true when it changed. */
async function refreshTarget(): Promise<boolean> {
  let raw: string | undefined;
  try {
    raw = await host.currentUrl();
  } catch {
    raw = undefined;
  }
  rawTargetUrl = raw;
  const target = parseTarget(raw);
  const nextUrl = target?.url ?? '';
  const changed = nextUrl !== currentUrl;
  currentUrl = nextUrl;
  currentDomain = target?.host ?? '';
  currentIsHttps = !!target?.https;
  return changed;
}

function setupLiveUpdates() {
  let refreshTimer: number | undefined;
  browser.cookies.onChanged.addListener((info) => {
    if (!currentDomain || !domainMatchesSite(info.cookie.domain, currentDomain)) return;
    const c = info.cookie;
    liveEntries.unshift({
      timestamp: Date.now(),
      removed: info.removed,
      cause: info.cause,
      cookie: { name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite },
    });
    if (liveEntries.length > LIVE_MAX) liveEntries.length = LIVE_MAX;
    if (isTabActive('monitor') && monitorView === 'live') renderMonitorLists();
    // Keep the list current while it is open; coalesce bursts.
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => { void loadCookies(); }, 300);
  });

  // Site access changed: granted from the empty state, or changed in Chrome's extension menu.
  browser.permissions.onAdded.addListener(() => { void loadCookies(); });
  browser.permissions.onRemoved.addListener(() => { void loadCookies(); });

  let targetTimer: number | undefined;
  host.onTargetChanged?.(() => {
    window.clearTimeout(targetTimer);
    targetTimer = window.setTimeout(async () => {
      if (await refreshTarget()) {
        selected.clear();
        liveEntries.length = 0;
        if (isTabActive('monitor')) {
          renderMonitorControls();
          renderMonitorLists();
        }
      }
      await loadCookies();
    }, 150);
  });
}

function setupSidePanelButton() {
  if (host.mode !== 'popup') return;
  const api = browser as unknown as {
    sidePanel?: { open(options: { windowId: number }): Promise<void> };
    sidebarAction?: { open(): Promise<void> };
  };
  if (!api.sidePanel?.open && !api.sidebarAction?.open) return;
  const button = el<HTMLButtonElement>('btn-sidepanel');
  button.hidden = false;
  let windowId: number | undefined;
  void browser.windows.getCurrent().then((w) => { windowId = w.id; });
  button.addEventListener('click', () => {
    // Called straight from the click: both APIs need the user gesture.
    const opening = api.sidePanel?.open && windowId !== undefined
      ? api.sidePanel.open({ windowId })
      : api.sidebarAction?.open();
    Promise.resolve(opening).then(
      () => window.close(),
      (err) => toast(t('toastSidePanelFailed', (err as Error).message), { error: true }),
    );
  });
}

// Tab navigation

function isTabActive(name: string): boolean {
  return el('tab-' + name).classList.contains('active');
}

function setupTabs() {
  const tabs = [...document.querySelectorAll<HTMLElement>('.tab')];
  const activate = (tab: HTMLElement) => {
    for (const t of tabs) {
      const on = t === tab;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    }
    document.querySelectorAll('.tab-content').forEach((tc) => tc.classList.remove('active'));
    const tabName = tab.dataset.tab;
    el('tab-' + tabName).classList.add('active');

    if (tabName === 'monitor') loadChangeLog();
    if (tabName === 'profiles') loadProfiles();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!;
      next.focus();
      activate(next);
    });
  });
}

// Keyboard: / to search, arrows through the list, Enter edits, Space selects, Delete deletes (with undo).

function focusRowById(id: string | null) {
  if (!id) return;
  const index = shownCookies.findIndex((c) => cookieIdentity(c) === id);
  const row = el('cookie-list').querySelectorAll<HTMLElement>('.cookie-item')[index];
  if (!row) return;
  el('cookie-list').querySelectorAll<HTMLElement>('.cookie-item').forEach((r) => { r.tabIndex = -1; });
  row.tabIndex = 0;
  row.focus();
}

function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const typing = !!target.closest('input, textarea, select, [contenteditable="true"]');
    const dialogOpen = !!document.querySelector('dialog[open]');
    const search = input('search');
    if (e.key === '/' && !typing && !dialogOpen && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (!isTabActive('cookies')) document.querySelector<HTMLElement>('.tab[data-tab="cookies"]')!.click();
      search.focus();
      search.select();
    } else if (target === search && e.key === 'Escape' && search.value) {
      e.preventDefault();
      search.value = '';
      renderCookies();
    } else if (target === search && e.key === 'ArrowDown' && shownCookies[0]) {
      e.preventDefault();
      focusRowById(cookieIdentity(shownCookies[0]));
    }
  });

  el('cookie-list').addEventListener('keydown', (e) => {
    const row = e.target as HTMLElement;
    if (!row.classList.contains('cookie-item')) return; // buttons and checkboxes keep their own keys
    const rows = [...el('cookie-list').querySelectorAll<HTMLElement>('.cookie-item')];
    const index = rows.indexOf(row);
    const cookie = shownCookies[index];
    if (!cookie) return;
    const idAt = (i: number) => (shownCookies[i] ? cookieIdentity(shownCookies[i]!) : null);
    switch (e.key) {
      case 'ArrowDown': focusRowById(idAt(Math.min(index + 1, rows.length - 1))); break;
      case 'ArrowUp': focusRowById(idAt(Math.max(index - 1, 0))); break;
      case 'Home': focusRowById(idAt(0)); break;
      case 'End': focusRowById(idAt(rows.length - 1)); break;
      case 'Enter': openEditor(cookie); break;
      case ' ': row.querySelector<HTMLInputElement>('.row-select')!.click(); break;
      case 'Delete':
      case 'Backspace': {
        const next = idAt(index + 1) ?? idAt(index - 1);
        void deleteCookie(cookie).then(() => focusRowById(next));
        break;
      }
      default: return;
    }
    e.preventDefault();
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
    `<button type="button" class="chip" data-chip="${chip}" aria-pressed="false">${escapeHtml(chipLabel(chip))} <span class="chip-count"></span></button>`,
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
  el('cookie-empty').addEventListener('click', (e) => {
    const action = (e.target as HTMLElement).closest<HTMLElement>('[data-empty]')?.dataset.empty;
    if (action === 'add') openEditor(null);
    else if (action === 'import') openImportDialog();
    else if (action === 'allow-site') {
      // Called straight from the click: permissions.request needs the user gesture.
      void browser.permissions.request({ origins: [siteAccessPattern(currentUrl)] }).then((granted) => {
        if (granted) void loadCookies();
      });
    }
    else if (action === 'clear-filters') {
      input('search').value = '';
      activeChips.clear();
      renderCookies();
    }
  });
  el('btn-clear-selection').addEventListener('click', () => {
    selected.clear();
    renderCookies();
  });
}

function renderSortDirection() {
  const button = el('btn-sort-dir');
  const asc = sortDir === 'asc';
  button.textContent = asc ? '↑' : '↓';
  button.title = asc ? t('sortAscending') : t('sortDescending');
  button.setAttribute('aria-label', asc ? t('sortDirectionAscending') : t('sortDirectionDescending'));
}

function saveSort() {
  void browser.storage.local.set({ listSort: { key: sortKey, dir: sortDir } });
}

async function loadCookies() {
  const domainInfo = el('domain-info');
  if (currentDomain) {
    domainInfo.textContent = currentDomain;
    const [response, access] = await Promise.all([
      send<CookiesResult>({ action: 'getCookies', url: currentUrl }),
      hasSiteAccess(currentUrl),
    ]);
    siteAccessWithheld = !access;
    allCookies = response.cookies || [];
    protectedIds = new Set(response.protectedIds || []);
    protectedHere = response.protected || [];
    blockedHere = response.blocked || [];
  } else {
    domainInfo.textContent = noTargetReason(rawTargetUrl).title;
    siteAccessWithheld = false;
    allCookies = [];
    protectedIds = new Set();
    protectedHere = [];
    blockedHere = [];
  }
  for (const id of ['btn-add', 'btn-export', 'btn-delete-all']) el<HTMLButtonElement>(id).disabled = !currentDomain || siteAccessWithheld;
  renderCookies();
  renderRulesPill();
}

/** False only when Chrome says host access to this site is withheld; the browser then hides its cookies. */
async function hasSiteAccess(url: string): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: [siteAccessPattern(url)] });
  } catch {
    return true;
  }
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
  const crowded = stats.crowdedDomains.length > 0;
  box.textContent = crowded
    ? t('statsTotalCrowded', formatBytes(stats.totalBytes), MAX_COOKIES_PER_DOMAIN, stats.crowdedDomains.join(', '))
    : t('statsTotal', formatBytes(stats.totalBytes));
  box.classList.toggle('is-warning', crowded);
  box.title = t('statsTitle', stats.largest!.name || t('noName'), stats.largest!.bytes, MAX_NAME_VALUE_BYTES, MAX_COOKIES_PER_DOMAIN);
}

function renderSelection() {
  // Forget selections of cookies that are gone.
  const present = new Set(allCookies.map((c) => cookieIdentity(c)));
  for (const id of [...selected]) if (!present.has(id)) selected.delete(id);

  el('selection-info').hidden = selected.size === 0;
  el('selection-count').textContent = t('selectionCount', selected.size);

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
  const listHadFocus = list.contains(document.activeElement);
  const searched = filterCookies(allCookies, input('search').value);
  shownCookies = sortCookies(applyChips(searched, activeChips), sortKey, sortDir);

  renderChips(searched);
  renderStats();
  renderSelection();
  el('cookie-count').textContent = shownCookies.length === allCookies.length
    ? tp('cookieCount', allCookies.length)
    : tp('cookieCountShown', allCookies.length, shownCookies.length);

  if (shownCookies.length === 0) {
    list.innerHTML = '';
    empty.innerHTML = emptyStateHtml();
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  // One row is in the tab order at a time; arrow keys move it.
  const tabStop = shownCookies.some((c) => cookieIdentity(c) === focusedRowId)
    ? focusedRowId
    : cookieIdentity(shownCookies[0]!);

  list.innerHTML = shownCookies.map((cookie, i) => {
    const id = cookieIdentity(cookie);
    const isSelected = selected.has(id);
    const isProtected = protectedIds.has(id);
    const bytes = cookieSize(cookie.name, cookie.value);
    const badges = [
      ...(isProtected ? [{ label: t('badgeLock'), kind: 'protected', title: t('badgeLockTitle') }] : []),
      ...cookieBadges(cookie),
    ].map((b) => `<span class="badge badge-${escapeHtml(b.kind)}" title="${escapeHtml(b.title)}">${escapeHtml(b.label)}</span>`).join('');
    const name = escapeHtml(cookie.name);
    const rawLabel = cookie.name || t('noName');
    const label = escapeHtml(rawLabel);
    const expiry = cookie.session || !cookie.expirationDate
      ? t('rowSessionTitle')
      : t('rowExpiresTitle', new Date(cookie.expirationDate * 1000).toLocaleString(), expiryLabel(cookie, now));

    return `
      <div class="cookie-item${isSelected ? ' is-selected' : ''}${isPartitioned(cookie) ? ' is-partitioned' : ''}${isProtected ? ' is-protected' : ''}" data-index="${i}" role="listitem" tabindex="${id === tabStop ? 0 : -1}">
        <input type="checkbox" class="row-select" aria-label="${escapeHtml(t('rowSelectLabel', rawLabel))}"${isSelected ? ' checked' : ''}>
        <span class="cookie-name" title="${name}">${label}</span>
        <span class="cookie-value" title="${escapeHtml(cookie.value)}">${escapeHtml(cookie.value)}</span>
        <span class="cookie-meta${bytes > SIZE_WARNING_BYTES ? ' is-large' : ''}" title="${escapeHtml(t('rowMetaTitle', expiry, bytes))}">${escapeHtml(shortExpiry(cookie, now))} · ${formatBytes(bytes)}</span>
        <span class="cookie-badges">${badges}</span>
        <span class="cookie-actions">
          <button class="btn-edit" title="${escapeHtml(t('rowEdit'))}" aria-label="${escapeHtml(t('rowEditLabel', rawLabel))}">&#9998;</button>
          <button class="btn-copy" title="${escapeHtml(t('rowCopy'))}" aria-label="${escapeHtml(t('rowCopyLabel', rawLabel))}">&#10697;</button>
          <button class="btn-delete" title="${escapeHtml(t('actionDelete'))}" aria-label="${escapeHtml(t('rowDeleteLabel', rawLabel))}">&#10005;</button>
        </span>
      </div>
    `;
  }).join('');

  list.querySelectorAll<HTMLElement>('.cookie-item').forEach((item) => {
    const cookie = shownCookies[parseInt(item.dataset.index!, 10)]!;
    const id = cookieIdentity(cookie);

    item.addEventListener('focus', () => { focusedRowId = id; });
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
      toast(await copyText(cookie.value) ? t('toastCopied') : t('copyFailed'));
    });
    item.querySelector('.btn-delete')!.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteCookie(cookie);
    });
    item.addEventListener('click', () => openEditor(cookie));
  });
  if (listHadFocus) focusRowById(tabStop);
}

function emptyStateHtml(): string {
  if (!currentDomain) {
    const reason = noTargetReason(rawTargetUrl);
    return `<h3>${escapeHtml(reason.title)}</h3><p>${escapeHtml(reason.detail)}</p>`;
  }
  if (siteAccessWithheld) {
    return `<h3>${escapeHtml(t('emptyNoAccessTitle', currentDomain))}</h3>
      <p>${escapeHtml(t('emptyNoAccessDetail'))}</p>
      <div class="empty-actions"><button type="button" class="action-btn primary" data-empty="allow-site">${escapeHtml(t('emptyAllowSite', currentDomain))}</button></div>`;
  }
  if (allCookies.length) {
    return `<h3>${escapeHtml(t('emptyNoMatchTitle'))}</h3>
      <p>${escapeHtml(t('emptyNoMatchDetail', currentDomain))}</p>
      <div class="empty-actions"><button type="button" class="action-btn" data-empty="clear-filters">${escapeHtml(t('emptyClearFilters'))}</button></div>`;
  }
  return `<h3>${escapeHtml(t('emptyNoCookiesTitle', currentDomain))}</h3>
    <p>${escapeHtml(t('emptyNoCookiesDetail'))}</p>
    <div class="empty-actions">
      <button type="button" class="action-btn" data-empty="add">${escapeHtml(t('emptyAddCookie'))}</button>
      <button type="button" class="action-btn" data-empty="import">${escapeHtml(t('actionImport'))}</button>
    </div>`;
}

async function deleteCookie(cookie: CookieLike) {
  const wasProtected = protectedIds.has(cookieIdentity(cookie));
  const res = await send<RemoveResult>({ action: 'removeCookies', cookies: [cookie] });
  await loadCookies();
  if (res.failed.length) {
    toast(t('toastDeleteFailed', cookie.name, res.failed[0]!.error), { error: true });
    return;
  }
  toast(wasProtected ? t('toastDeletedUnprotected', cookie.name) : t('toastDeleted', cookie.name), {
    actionLabel: t('actionUndo'),
    onAction: () => undoRemoval(res.removed),
  });
}

async function deleteSelected() {
  const targets = allCookies.filter((c) => selected.has(cookieIdentity(c)));
  if (targets.length === 0) return;
  const n = targets.length;
  const ok = await confirmDialog(tp('confirmDeleteSelected', n), t('confirmUndoDetail'), t('confirmDeleteCount', n));
  if (!ok) return;
  const res = await send<RemoveResult>({ action: 'removeCookies', cookies: targets });
  selected.clear();
  await loadCookies();
  const message = res.failed.length
    ? t('toastDeletedPartial', res.removed.length, n, res.failed.length)
    : tp('toastDeletedCount', res.removed.length);
  toast(message, { actionLabel: t('actionUndo'), onAction: () => undoRemoval(res.removed) });
}

async function undoRemoval(snapshot: CookieLike[]) {
  const report = await send<WriteReport>({ action: 'restoreCookies', cookies: snapshot });
  await loadCookies();
  toast(describeWrite(tp('writeRestored', report.written.length), report), { error: report.failed.length > 0 });
}

// Actions

function setupActions() {
  el('btn-add').addEventListener('click', () => openEditor(null));
  el('btn-import').addEventListener('click', () => openImportDialog());

  el('btn-delete-all').addEventListener('click', async () => {
    if (allCookies.length === 0) {
      toast(t('toastNothingToDelete'));
      return;
    }
    const snapshot = allCookies.slice();
    const n = snapshot.length;
    const ok = await confirmDialog(
      tp('confirmDeleteAll', n, currentDomain),
      t('confirmDeleteAllDetail'),
      t('confirmDeleteCount', n),
    );
    if (!ok) return;
    const res = await send<RemoveResult>({ action: 'removeCookies', cookies: snapshot });
    await loadCookies();
    const message = res.failed.length
      ? t('toastDeletedPartial', res.removed.length, n, res.failed.length)
      : tp('toastDeletedCount', res.removed.length);
    toast(message, { actionLabel: t('actionUndo'), onAction: () => undoRemoval(res.removed) });
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

// Protect and Block rules for this site

function setupRules() {
  el('btn-rules').addEventListener('click', () => {
    renderRulesDialog();
    el<HTMLDialogElement>('rules-dialog').showModal();
  });
  el('rules-body').addEventListener('click', async (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-rule]');
    if (!button) return;
    const index = Number(button.dataset.index);
    button.disabled = true;
    if (button.dataset.rule === 'block') {
      await send({ action: 'unblockCookie', id: blockedHere[index]!.id });
    } else {
      await send({ action: 'setProtect', cookie: protectedHere[index]!.cookie, on: false });
    }
    await loadCookies();
    renderRulesDialog();
  });
}

function renderRulesPill() {
  const pill = el<HTMLButtonElement>('btn-rules');
  const parts: string[] = [];
  if (protectedHere.length) parts.push(t('rulesPillProtected', protectedHere.length));
  if (blockedHere.length) parts.push(t('rulesPillBlocked', blockedHere.length));
  pill.hidden = parts.length === 0;
  pill.textContent = parts.join(' · ');
}

function renderRulesDialog() {
  el('rules-title').textContent = t('rulesTitle', currentDomain);
  const protectRows = protectedHere.map((r, i) => `
    <li>
      <span class="rule-kind is-protect">${escapeHtml(t('ruleProtected'))}</span>
      <span class="imp-name" title="${escapeHtml(r.cookie.name)}">${escapeHtml(r.cookie.name)}</span>
      <span class="imp-domain">${escapeHtml(r.cookie.domain)}</span>
      <button type="button" class="action-btn" data-rule="protect" data-index="${i}">${escapeHtml(t('actionUnprotect'))}</button>
    </li>`).join('');
  const blockRows = blockedHere.map((r, i) => `
    <li>
      <span class="rule-kind is-block">${escapeHtml(t('ruleBlocked'))}</span>
      <span class="imp-name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>
      <span class="imp-domain">${escapeHtml(r.domain)}</span>
      <button type="button" class="action-btn" data-rule="block" data-index="${i}">${escapeHtml(t('actionUnblock'))}</button>
    </li>`).join('');
  el('rules-body').innerHTML = protectRows || blockRows
    ? `<ul class="import-list rules-list">${protectRows}${blockRows}</ul>`
    : `<p class="dialog-sub">${escapeHtml(t('rulesNone'))}</p>`;
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
  // Back to the row the editor was opened from (Esc, Cancel or Save).
  dialog.addEventListener('close', () => focusRowById(focusedRowId));

  input('edit-session').addEventListener('change', () => {
    const expires = input('edit-expires');
    expires.disabled = input('edit-session').checked;
    if (!expires.disabled && !expires.value) expires.value = toDatetimeLocal(Date.now() / 1000 + YEAR_SECONDS);
  });

  el('btn-editor-block').addEventListener('click', blockEditingCookie);
}

async function blockEditingCookie() {
  const cookie = editingCookie;
  if (!cookie) return;
  closeEditor();
  const site = cookieHost(cookie.domain);
  const ok = await confirmDialog(
    t('confirmBlock', cookie.name, site),
    t('confirmBlockDetail'),
    t('actionBlock'),
  );
  if (!ok) return;
  const res = await send<BlockResult>({ action: 'blockCookie', cookie });
  await loadCookies();
  toast(t('toastBlocked', cookie.name, site), {
    actionLabel: t('actionUndo'),
    onAction: async () => {
      await send({ action: 'unblockCookie', id: res.rule.id });
      const report = await send<WriteReport>({ action: 'restoreCookies', cookies: res.removed });
      await loadCookies();
      toast(describeWrite(tp('writeUnblockedRestored', report.written.length), report), { error: report.failed.length > 0 });
    },
  });
}

function onEditorChange(e: Event) {
  const target = e.target as HTMLElement;
  if (target.closest('#value-inspector') || target.id === 'edit-protect') return;
  confirmArmed = false;
  el('btn-editor-save').textContent = t('actionSave');
  el('editor-error').hidden = true;
  refreshValidation();
  if (target.id === 'edit-value') {
    renderInspector(el('value-inspector'), el<HTMLTextAreaElement>('edit-value').value);
  }
}

function openEditor(cookie: CookieLike | null) {
  editingCookie = cookie;
  editorSubmitted = false;
  confirmArmed = false;
  el('btn-editor-save').textContent = t('actionSave');
  el('editor-error').hidden = true;
  el('editor-title').textContent = cookie ? t('editorTitleEdit') : t('editorTitleAdd');
  el('btn-editor-block').hidden = !cookie;
  input('edit-protect').checked = !!cookie && protectedIds.has(cookieIdentity(cookie));

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
    partition.textContent = pk.hasCrossSiteAncestor
      ? t('editorPartitionedCrossSite', pk.topLevelSite)
      : t('editorPartitioned', pk.topLevelSite);
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
  meter.textContent = t('editorSize', size.toLocaleString(), MAX_NAME_VALUE_BYTES.toLocaleString());
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
    saveBtn.textContent = editingCookie ? t('editorSaveAndDelete') : t('editorSaveAnyway');
    return;
  }

  const draft = readDraft();
  const original = editingCookie;
  const protect = input('edit-protect').checked;
  const wasProtected = !!original && protectedIds.has(cookieIdentity(original));
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
    res = await send<UpdateResult>({ action: 'updateCookie', original, cookie, protect });
  } catch (err) {
    res = { error: (err as Error).message };
  } finally {
    saveBtn.disabled = false;
  }

  if (res.error) {
    const box = el('editor-error');
    box.textContent = original ? t('editorRejectedKept', res.error) : t('editorRejectedNotAdded', res.error);
    box.hidden = false;
    confirmArmed = false;
    saveBtn.textContent = t('actionSave');
    return;
  }

  closeEditor();
  let message: string;
  if (res.deleted) message = t('toastDeletedPastExpiry', cookie.name);
  else if (protect && !wasProtected) message = original ? t('toastCookieUpdatedProtected') : t('toastCookieAddedProtected');
  else if (!protect && wasProtected) message = t('toastCookieUpdatedUnprotected');
  else message = original ? t('toastCookieUpdated') : t('toastCookieAdded');
  toast(res.warning ?? message, { error: !!res.warning });
  loadCookies();
}

// Export menu

/** Selected cookies if any are selected, otherwise the cookies the list shows. */
function exportTargets(): { cookies: CookieLike[]; scope: string } {
  if (selected.size) {
    const cookies = allCookies.filter((c) => selected.has(cookieIdentity(c)));
    return { cookies, scope: tp('exportScopeSelected', cookies.length) };
  }
  if (shownCookies.length !== allCookies.length) {
    return { cookies: shownCookies, scope: t('exportScopeShown', shownCookies.length, allCookies.length) };
  }
  return { cookies: allCookies, scope: tp('exportScopeAll', allCookies.length) };
}

function setupExportMenu() {
  const btn = el('btn-export');
  const menu = el('export-menu');
  el('export-rows').innerHTML = EXPORT_FORMATS.map((f) => `
    <div class="export-row">
      <span>${escapeHtml(exportFormatLabel(f.id))}</span>
      <button type="button" data-format="${f.id}" data-action="copy">${escapeHtml(t('actionCopy'))}</button>
      <button type="button" data-format="${f.id}" data-action="download">${escapeHtml(t('actionDownload'))}</button>
    </div>`).join('');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = btn.getBoundingClientRect();
    menu.style.top = rect.bottom + 2 + 'px';
    menu.style.right = (document.body.clientWidth - rect.right) + 'px';
    el('export-scope').textContent = exportTargets().scope;
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
      toast(tp('toastDownloaded', cookies.length, exportFormatLabel(format)));
    } else if (await copyText(text)) {
      toast(tp('toastCopiedFormat', cookies.length, exportFormatLabel(format)));
    } else {
      toast(t('copyFailed'), { error: true });
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
    if (monitorView === 'saved') renderEntries([], savedEmptyText());
    toast(t('toastLogCleared'));
  });

  el('monitor-view-live').addEventListener('click', () => setMonitorView('live'));
  el('monitor-view-saved').addEventListener('click', () => setMonitorView('saved'));

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.monitor) {
      monitorSettings = normalizeMonitorSettings(changes.monitor.newValue);
      renderMonitorControls();
    }
    if (changes.changeLog && isTabActive('monitor') && monitorView === 'saved') {
      renderEntries((changes.changeLog.newValue as ChangeEntry[]) || [], savedEmptyText());
    }
  });
}

function setMonitorView(view: 'live' | 'saved') {
  monitorView = view;
  renderMonitorLists();
}

async function saveMonitorSettings(next: MonitorSettings) {
  monitorSettings = normalizeMonitorSettings(next);
  renderMonitorControls();
  await browser.storage.local.set({ monitor: monitorSettings });
}

function renderMonitorControls() {
  const { recording, scope, site } = monitorSettings;
  input('monitor-record').checked = recording;

  const options = [{ value: 'all', label: t('monitorScopeAll') }];
  if (scope === 'site' && site && site !== currentDomain) options.push({ value: `site:${site}`, label: t('monitorScopeOnly', site) });
  if (currentDomain) options.push({ value: `site:${currentDomain}`, label: t('monitorScopeOnly', currentDomain) });
  const select = el<HTMLSelectElement>('monitor-scope');
  select.innerHTML = options
    .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
    .join('');
  select.value = scope === 'site' ? `site:${site}` : 'all';

  const status = el('monitor-status');
  status.textContent = recording ? t('monitorStatusRecording') : t('monitorStatusOff');
  status.classList.toggle('is-recording', recording);

  el('monitor-note').textContent = recording ? t('monitorNoteRecording', maxLog) : t('monitorNoteOff', maxLog);
}

async function loadChangeLog() {
  const data = await browser.storage.local.get({ monitor: DEFAULT_MONITOR, maxLog: DEFAULT_MAX_LOG });
  monitorSettings = normalizeMonitorSettings(data.monitor);
  maxLog = clampMaxLog(data.maxLog);
  renderMonitorControls();
  renderMonitorLists();
}

function savedEmptyText(): string {
  return monitorSettings.recording
    ? t('monitorSavedEmptyRecording')
    : t('monitorSavedEmptyOff');
}

function renderMonitorLists() {
  el('monitor-view-live').setAttribute('aria-selected', String(monitorView === 'live'));
  el('monitor-view-saved').setAttribute('aria-selected', String(monitorView === 'saved'));
  el('monitor-view-live').textContent = currentDomain ? t('monitorLiveOn', currentDomain) : t('monitorLiveOnThisPage');
  if (monitorView === 'live') {
    renderEntries(liveEntries, currentDomain
      ? t('monitorLiveWatching', currentDomain)
      : t('monitorLiveNoPage'));
    return;
  }
  void send<{ changeLog: ChangeEntry[] }>({ action: 'getChangeLog' }).then((response) => {
    if (monitorView === 'saved') renderEntries(response.changeLog || [], savedEmptyText());
  });
}

function renderEntries(log: ChangeEntry[], emptyText: string) {
  const container = el('change-log');
  const empty = el('monitor-empty');

  if (log.length === 0) {
    container.innerHTML = '';
    empty.textContent = emptyText;
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  container.innerHTML = log.map((entry) => {
    const isRemoved = entry.removed;
    const iconClass = isRemoved ? 'removed' : 'added';
    const icon = isRemoved ? '−' : '+';
    const cause = causeLabel(entry.cause);
    const value = entry.cookie.value ?? '';

    return `
      <div class="change-entry">
        <span class="change-icon ${iconClass}" aria-label="${escapeHtml(isRemoved ? t('changeRemoved') : t('changeSet'))}">${icon}</span>
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
    if (!name) { toast(t('toastEnterProfileName')); return; }
    const response = await send<{ count: number }>({
      action: 'saveProfile',
      name,
      url: currentUrl,
    });
    toast(tp('toastProfileSaved', response.count, name));
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
        <span class="profile-meta">${escapeHtml(tp('profileMeta', p.count, date))}</span>
        <span class="profile-actions">
          <button class="action-btn btn-load-profile" aria-label="${escapeHtml(t('profileLoadLabel', name))}">${escapeHtml(t('actionLoad'))}</button>
          <button class="action-btn danger btn-delete-profile" title="${escapeHtml(t('profileDeleteTitle'))}" aria-label="${escapeHtml(t('profileDeleteLabel', name))}">&#10005;</button>
        </span>
      </div>
    `;
  }).join('');

  container.querySelectorAll<HTMLElement>('.profile-item').forEach((item) => {
    const name = item.dataset.name!;
    item.querySelector('.btn-load-profile')!.addEventListener('click', async () => {
      const res = await send<LoadProfileResult>({ action: 'loadProfile', name, clearFirst: true });
      if (res.error) {
        toast(t('toastError', res.error), { error: true });
        return;
      }
      await loadCookies();
      toast(describeWrite(tp('writeLoaded', res.written.length, name), res), {
        actionLabel: t('actionUndo'),
        onAction: async () => {
          await send<RemoveResult>({ action: 'removeCookies', cookies: res.written });
          const report = await send<WriteReport>({ action: 'restoreCookies', cookies: res.previous });
          await loadCookies();
          toast(describeWrite(tp('writeUndoneRestored', report.written.length), report), { error: report.failed.length > 0 });
        },
      });
    });
    item.querySelector('.btn-delete-profile')!.addEventListener('click', async () => {
      const ok = await confirmDialog(t('confirmDeleteProfile', name), t('confirmDeleteProfileDetail'), t('actionDelete'));
      if (!ok) return;
      await send({ action: 'deleteProfile', name });
      toast(t('toastProfileDeleted', name));
      loadProfiles();
    });
  });
}
