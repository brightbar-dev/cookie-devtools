// Export encrypted: ask for a password, say what the file grants, then download or copy it.
import { encryptShare, serializeShare, passwordProblem, MIN_PASSWORD_LENGTH } from '@/utils/share';
import type { ShareErrorCode } from '@/utils/share';
import { formatExport, encryptedFilename } from '@/utils/export';
import type { CookieLike } from '@/utils/cookies';
import { t, tp } from '@/utils/i18n';
import { el, input, toast, copyText, downloadText } from './dom';

export interface ShareHost {
  /** What an export covers right now: the selection, the shown cookies or all of them. */
  targets: () => { cookies: CookieLike[]; scope: string };
  /** The site the file is named after. */
  site: () => string;
  /** Called after a file was downloaded or copied. */
  onShared: () => void;
}

let host: ShareHost;
let busy = false;

/** The message for a password rejected when writing a file. */
export function passwordMessage(code: ShareErrorCode): string {
  return code === 'password-short' ? t('shareErrorShort', MIN_PASSWORD_LENGTH) : t('shareErrorEmpty');
}

export function setupShareDialog(shareHost: ShareHost) {
  host = shareHost;
  const dialog = el<HTMLDialogElement>('share-dialog');

  input('share-show').addEventListener('change', () => {
    const type = input('share-show').checked ? 'text' : 'password';
    input('share-password').type = type;
    input('share-confirm').type = type;
  });
  for (const id of ['share-password', 'share-confirm']) input(id).addEventListener('input', () => showError(''));
  el('btn-share-cancel').addEventListener('click', () => dialog.close());
  el('share-form').addEventListener('submit', (e) => {
    e.preventDefault();
    void run('download');
  });
  el('btn-share-copy').addEventListener('click', () => void run('copy'));
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  // Don't keep the password in the page once the dialog is gone.
  dialog.addEventListener('close', reset);
}

export function openShareDialog() {
  reset();
  const { cookies, scope } = host.targets();
  el('share-scope').textContent = scope;
  for (const id of ['btn-share-copy', 'btn-share-download']) el<HTMLButtonElement>(id).disabled = cookies.length === 0;
  el<HTMLDialogElement>('share-dialog').showModal();
  input('share-password').focus();
}

function reset() {
  busy = false;
  for (const id of ['share-password', 'share-confirm']) {
    input(id).value = '';
    input(id).type = 'password';
    input(id).removeAttribute('aria-invalid');
  }
  input('share-show').checked = false;
  showError('');
  setBusy(false);
}

function showError(message: string, field?: string) {
  el('share-msg').textContent = message;
  for (const id of ['share-password', 'share-confirm']) {
    if (message && (!field || field === id)) input(id).setAttribute('aria-invalid', 'true');
    else input(id).removeAttribute('aria-invalid');
  }
}

function setBusy(on: boolean) {
  busy = on;
  const download = el<HTMLButtonElement>('btn-share-download');
  download.textContent = on ? t('shareEncrypting') : t('actionDownload');
  for (const id of ['btn-share-copy', 'btn-share-download']) el<HTMLButtonElement>(id).disabled = on || host?.targets().cookies.length === 0;
  el('share-form').setAttribute('aria-busy', String(on));
}

async function run(action: 'download' | 'copy') {
  if (busy) return;
  const password = input('share-password').value;
  const problem = passwordProblem(password);
  if (problem) {
    showError(passwordMessage(problem), 'share-password');
    input('share-password').focus();
    return;
  }
  if (password !== input('share-confirm').value) {
    showError(t('shareErrorMismatch'), 'share-confirm');
    input('share-confirm').focus();
    return;
  }

  const { cookies } = host.targets();
  if (cookies.length === 0) return;
  setBusy(true);
  let text: string;
  try {
    text = serializeShare(await encryptShare(formatExport('json', cookies), password));
  } catch (err) {
    setBusy(false);
    showError(t('shareErrorFailed', (err as Error).message));
    return;
  }
  setBusy(false);

  const label = t('exportFormatEncrypted');
  if (action === 'download') {
    downloadText(encryptedFilename(host.site(), new Date()), text, 'application/json');
    toast(tp('toastDownloaded', cookies.length, label));
  } else if (await copyText(text)) {
    toast(tp('toastCopiedFormat', cookies.length, label));
  } else {
    showError(t('copyFailed'));
    return;
  }
  el<HTMLDialogElement>('share-dialog').close();
  host.onShared();
}
