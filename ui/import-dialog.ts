// Import dialog: paste, open or drop an export, preview what will happen, then apply.
import { planImport, compareWithExisting, formatLabel } from '@/utils/importer';
import type { ImportPlan } from '@/utils/importer';
import { escapeHtml, domainAppliesToHost } from '@/utils/cookies';
import type { CookieLike } from '@/utils/cookies';
import type { WriteReport } from '@/utils/messages';
import { parseShare, decryptShare, ShareError } from '@/utils/share';
import type { EncryptedShare } from '@/utils/share';
import { t, tp } from '@/utils/i18n';
import { el, input, send } from './dom';

export interface ImportHost {
  /** The page cookies without a domain of their own are imported for. */
  url: () => string;
  existing: () => CookieLike[];
  onApplied: () => void;
  /** Offered where a file picker may close the page (the popup). */
  openInTab?: () => void;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

let host: ImportHost;
let plan: ImportPlan | null = null;
let applied = false;
let debounce: number | undefined;
/** Set while the pasted or opened text is one of our encrypted files that has not been decrypted yet. */
let locked: EncryptedShare | null = null;
let decrypting = false;

const textArea = () => el<HTMLTextAreaElement>('import-text');
const applyButton = () => el<HTMLButtonElement>('btn-import-apply');

export function setupImportDialog(importHost: ImportHost) {
  host = importHost;
  const dialog = el<HTMLDialogElement>('import-dialog');
  const text = textArea();
  const fileInput = el<HTMLInputElement>('import-file');

  text.addEventListener('input', () => {
    el('import-source').textContent = '';
    window.clearTimeout(debounce);
    debounce = window.setTimeout(refresh, 120);
  });
  el('btn-import-file').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (file) await loadFile(file);
    fileInput.value = '';
  });
  text.addEventListener('dragover', (e) => {
    e.preventDefault();
    text.classList.add('is-dragover');
  });
  text.addEventListener('dragleave', () => text.classList.remove('is-dragover'));
  text.addEventListener('drop', async (e) => {
    const file = e.dataTransfer?.files?.[0];
    text.classList.remove('is-dragover');
    if (!file) return;
    e.preventDefault();
    await loadFile(file);
  });

  const tabButton = el('btn-import-tab');
  if (importHost.openInTab) tabButton.addEventListener('click', importHost.openInTab);
  else tabButton.hidden = true;

  input('import-password-show').addEventListener('change', () => {
    input('import-password').type = input('import-password-show').checked ? 'text' : 'password';
  });
  input('import-password').addEventListener('input', () => showPasswordError(''));
  // Decrypted cookies and the password live only while the dialog is open.
  dialog.addEventListener('close', () => {
    locked = null;
    plan = null;
    clearPassword();
  });

  el('btn-import-cancel').addEventListener('click', () => dialog.close());
  el('import-form').addEventListener('submit', (e) => {
    e.preventDefault();
    void apply();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}

export function openImportDialog() {
  textArea().value = '';
  el('import-source').textContent = '';
  refresh();
  el<HTMLDialogElement>('import-dialog').showModal();
  textArea().focus();
}

function clearPassword() {
  input('import-password').value = '';
  input('import-password').type = 'password';
  input('import-password-show').checked = false;
  showPasswordError('');
}

function showPasswordError(message: string) {
  el('import-password-msg').textContent = message;
  el('import-password-msg').classList.toggle('is-error', !!message);
  if (message) input('import-password').setAttribute('aria-invalid', 'true');
  else input('import-password').removeAttribute('aria-invalid');
}

function shareErrorMessage(err: unknown): string {
  if (err instanceof ShareError) {
    if (err.code === 'unsupported-version') return t('shareErrorVersion', err.version ?? 0);
    if (err.code === 'wrong-password') return t('shareErrorWrong');
    if (err.code === 'password-empty') return t('shareErrorEmpty');
  }
  return t('shareErrorMalformed');
}

async function loadFile(file: File) {
  if (file.size > MAX_FILE_BYTES) {
    el('import-preview').innerHTML = `<p class="import-error">${escapeHtml(t('importFileTooLarge', file.name))}</p>`;
    return;
  }
  textArea().value = await file.text();
  el('import-source').textContent = file.name;
  refresh();
  if (locked) input('import-password').focus();
}

function flags(c: CookieLike): string {
  const parts: string[] = [];
  if (c.secure) parts.push(t('attrSecure'));
  if (c.httpOnly) parts.push(t('attrHttpOnly'));
  parts.push(c.session ? t('attrSession') : t('attrPersistent'));
  if (c.partitionKey?.topLevelSite) parts.push(t('attrPartitioned'));
  return parts.join(' · ');
}

function refresh() {
  applied = false;
  locked = null;
  plan = null;
  clearPassword();
  const raw = textArea().value;
  const preview = el('import-preview');
  const passwordRow = el('import-password-row');
  passwordRow.hidden = true;

  let share: EncryptedShare | null = null;
  try {
    share = parseShare(raw);
  } catch (err) {
    el('import-format').textContent = t('exportFormatEncrypted');
    applyButton().disabled = true;
    applyButton().textContent = t('actionImport');
    preview.innerHTML = `<p class="import-error" role="alert">${escapeHtml(shareErrorMessage(err))}</p>`;
    return;
  }
  if (share) {
    locked = share;
    el('import-format').textContent = t('exportFormatEncrypted');
    passwordRow.hidden = false;
    applyButton().disabled = false;
    applyButton().textContent = t('shareDecrypt');
    preview.innerHTML = '';
    return;
  }
  renderPlan(raw);
}

/** Plan the cookies in plain text (typed, or decrypted) and show what importing will do. */
function renderPlan(text: string, decrypted = false) {
  const url = host.url();
  plan = planImport(text, { url, nowSeconds: Date.now() / 1000 });

  el('import-format').textContent = decrypted ? t('exportFormatEncrypted') : text.trim() ? formatLabel(plan.format) : '';
  const button = applyButton();
  button.disabled = plan.cookies.length === 0;
  button.textContent = plan.cookies.length ? tp('importApply', plan.cookies.length) : t('actionImport');

  const preview = el('import-preview');
  if (plan.error) {
    preview.innerHTML = text.trim() ? `<p class="import-error">${escapeHtml(plan.error)}</p>` : '';
    return;
  }

  const { create, replace } = compareWithExisting(plan.cookies, host.existing());
  const summary = [t('importWillCreate', create)];
  if (replace) summary.push(t('importWillReplace', replace));
  summary.push(t('importSkippedCount', plan.skipped.length));

  let pageHost = '';
  try {
    pageHost = new URL(url).hostname;
  } catch {
    // no current site
  }
  const elsewhere = pageHost ? plan.cookies.filter((c) => !domainAppliesToHost(c.domain, pageHost)) : [];
  const otherSites = [...new Set(elsewhere.map((c) => c.domain.replace(/^\./, '')))];
  const sites = otherSites.slice(0, 3).join(', ') + (otherSites.length > 3 ? '…' : '');
  const note = elsewhere.length
    ? `<p class="import-note">${escapeHtml(tp('importOtherSites', elsewhere.length, sites))}</p>`
    : '';

  const rows = plan.cookies.map((c) => `
    <li>
      <span class="imp-mark" aria-hidden="true">+</span>
      <span class="imp-name" title="${escapeHtml(c.name)}">${escapeHtml(c.name) || escapeHtml(t('noName'))}</span>
      <span class="imp-domain">${escapeHtml(c.domain + (c.path !== '/' ? c.path : ''))}</span>
      <span class="imp-detail">${escapeHtml(flags(c))}</span>
    </li>`).join('');
  const skipped = plan.skipped.map((s) => `
    <li class="is-skipped">
      <span class="imp-mark" aria-hidden="true">–</span>
      <span class="imp-name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span>
      <span class="imp-detail">${escapeHtml(t('importSkippedReason', s.reason))}</span>
    </li>`).join('');

  const decryptedNote = decrypted ? `<p class="import-note">${escapeHtml(t('shareImportDecrypted'))}</p>` : '';
  preview.innerHTML = `
    <p class="import-summary">${escapeHtml(summary.join(' · '))}</p>
    ${decryptedNote}${note}
    ${rows || skipped ? `<ul class="import-list">${rows}${skipped}</ul>` : ''}`;
}

/** Decrypts the opened file; only on success does the preview (and so the import) exist. */
async function unlock(share: EncryptedShare) {
  if (decrypting) return;
  const password = input('import-password').value;
  if (!password) {
    showPasswordError(t('shareErrorEmpty'));
    input('import-password').focus();
    return;
  }
  const button = applyButton();
  decrypting = true;
  button.disabled = true;
  button.textContent = t('shareDecrypting');
  el('import-form').setAttribute('aria-busy', 'true');
  try {
    const text = await decryptShare(share, password);
    locked = null;
    el('import-password-row').hidden = true;
    clearPassword();
    renderPlan(text, true);
    button.focus();
  } catch (err) {
    button.disabled = false;
    button.textContent = t('shareDecrypt');
    showPasswordError(shareErrorMessage(err));
    input('import-password').focus();
    input('import-password').select();
  } finally {
    decrypting = false;
    el('import-form').removeAttribute('aria-busy');
  }
}

async function apply() {
  const dialog = el<HTMLDialogElement>('import-dialog');
  if (applied) {
    dialog.close();
    return;
  }
  if (locked) {
    await unlock(locked);
    return;
  }
  if (!plan || plan.cookies.length === 0) return;

  const button = applyButton();
  button.disabled = true;
  let report: WriteReport;
  try {
    report = await send<WriteReport>({ action: 'importCookies', cookies: plan.cookies });
  } catch (err) {
    report = { written: [], expired: [], failed: plan.cookies.map((c) => ({ name: c.name, domain: c.domain, error: (err as Error).message })) };
  }
  applied = true;
  button.disabled = false;
  button.textContent = t('importDone');

  const summary = [t('importImported', report.written.length)];
  if (report.failed.length) summary.push(t('importFailedCount', report.failed.length));
  const skippedCount = plan.skipped.length + report.expired.length;
  if (skippedCount) summary.push(t('importSkippedCount', skippedCount));

  const failed = report.failed.map((f) => `
    <li class="is-failed">
      <span class="imp-mark" aria-hidden="true">✗</span>
      <span class="imp-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
      <span class="imp-domain">${escapeHtml(f.domain ?? '')}</span>
      <span class="imp-detail">${escapeHtml(f.error)}</span>
    </li>`).join('');
  const ok = report.written.map((c) => `
    <li class="is-ok">
      <span class="imp-mark" aria-hidden="true">✓</span>
      <span class="imp-name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>
      <span class="imp-domain">${escapeHtml(c.domain)}</span>
    </li>`).join('');
  el('import-preview').innerHTML = `
    <p class="import-summary">${escapeHtml(summary.join(' · '))}</p>
    <ul class="import-list">${failed}${ok}</ul>`;
  button.focus();
  host.onApplied();
}
