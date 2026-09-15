import { clampMaxLog } from '@/utils/monitor';
import { escapeHtml } from '@/utils/cookies';
import { t } from '@/utils/i18n';
import { localize } from '@/ui/dom';
import type { Rules } from '@/utils/rules';

async function renderRules() {
  const list = document.getElementById('rules-list')!;
  const { rules } = (await browser.runtime.sendMessage({ action: 'getRules' })) as { rules: Rules };
  const rows = [
    ...rules.protect.map((r) => ({ kind: t('ruleProtected'), unlabel: t('actionUnprotect'), name: r.cookie.name, domain: r.cookie.domain, message: { action: 'setProtect', cookie: r.cookie, on: false } })),
    ...rules.block.map((r) => ({ kind: t('ruleBlocked'), unlabel: t('actionUnblock'), name: r.name, domain: r.domain, message: { action: 'unblockCookie', id: r.id } })),
  ];
  if (rows.length === 0) {
    list.innerHTML = `<li class="rules-empty">${escapeHtml(t('optionsRulesNone'))}</li>`;
    return;
  }
  list.innerHTML = rows.map((row, i) => `
    <li>
      <span class="rule-kind">${escapeHtml(row.kind)}</span>
      <span class="rule-name">${escapeHtml(row.name)}</span>
      <span class="rule-domain">${escapeHtml(row.domain)}</span>
      <button class="action-btn" data-index="${i}">${escapeHtml(row.unlabel)}</button>
    </li>`).join('');
  list.querySelectorAll<HTMLButtonElement>('button[data-index]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      await browser.runtime.sendMessage(rows[Number(button.dataset.index)]!.message);
      await renderRules();
    });
  });
}
import './style.css';

document.addEventListener('DOMContentLoaded', async () => {
  localize(document);
  const themeSelect = document.getElementById('theme') as HTMLSelectElement;
  const maxLogSelect = document.getElementById('max-log') as HTMLSelectElement;

  const data = await browser.storage.local.get({ theme: 'auto', maxLog: 500 });
  themeSelect.value = data.theme as string;
  maxLogSelect.value = String(clampMaxLog(data.maxLog));
  void renderRules();
  document.getElementById('about-version')!.textContent = t('optionsAboutVersion', browser.runtime.getManifest().version);

  themeSelect.addEventListener('change', () => {
    browser.storage.local.set({ theme: themeSelect.value });
  });

  maxLogSelect.addEventListener('change', () => {
    browser.storage.local.set({ maxLog: parseInt(maxLogSelect.value) });
  });

  document.getElementById('btn-clear-data')!.addEventListener('click', async () => {
    if (confirm(t('optionsClearDataConfirm'))) {
      await browser.storage.local.set({ profiles: {}, changeLog: [] });
      alert(t('optionsDataCleared'));
    }
  });
});
