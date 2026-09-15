// Small DOM, messaging and string helpers shared by the extension's pages.
import type { WriteReport } from '@/utils/messages';
import { t } from '@/utils/i18n';
import type { MessageKey } from '@/utils/i18n';

export const UNDO_MS = 10_000;

export const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export const input = (id: string) => el<HTMLInputElement>(id);

export function send<T>(message: Record<string, unknown>): Promise<T> {
  return browser.runtime.sendMessage(message) as Promise<T>;
}

const I18N_ATTRIBUTES = ['title', 'aria-label', 'placeholder'];

/** Fills text from data-i18n, and attributes from data-i18n-title, data-i18n-aria-label and data-i18n-placeholder. */
export function localize(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n as MessageKey);
  });
  for (const attr of I18N_ATTRIBUTES) {
    root.querySelectorAll<HTMLElement>(`[data-i18n-${attr}]`).forEach((node) => {
      node.setAttribute(attr, t(node.getAttribute(`data-i18n-${attr}`) as MessageKey));
    });
  }
}

export interface ToastOptions {
  actionLabel?: string;
  onAction?: () => void;
  error?: boolean;
}

let toastTimer: number | undefined;

export function toast(message: string, opts: ToastOptions = {}) {
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
    button.textContent = opts.actionLabel || t('actionUndo');
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

/** A write's outcome: the headline (what was written), then what expired or failed. */
export function describeWrite(headline: string, report: WriteReport): string {
  const parts = [headline];
  if (report.expired.length) parts.push(t('writeExpiredSkipped', report.expired.length));
  if (report.failed.length) parts.push(t('writeFailed', report.failed.length, report.failed.map((f) => f.name).join(', ')));
  return parts.join(' · ');
}

export function confirmDialog(message: string, detail: string, okLabel: string): Promise<boolean> {
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

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Save text as a file through an anchor download — no `downloads` permission needed. */
export function downloadText(filename: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
