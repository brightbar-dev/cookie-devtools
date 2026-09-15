// Value inspector: read-only decoded views of a cookie value beside the raw editor.
import { decodeValue } from '@/utils/decode';
import type { JwtView } from '@/utils/decode';
import { escapeHtml } from '@/utils/cookies';
import { t } from '@/utils/i18n';
import { copyText } from './dom';

type ViewId = 'jwt' | 'json' | 'url' | 'base64';

const VIEW_ORDER: ViewId[] = ['jwt', 'json', 'url', 'base64'];

function viewLabel(view: ViewId): string {
  switch (view) {
    case 'jwt': return t('inspectorViewJwt');
    case 'json': return t('inspectorViewJson');
    case 'url': return t('inspectorViewUrl');
    case 'base64': return t('inspectorViewBase64');
  }
}

// The view last picked stays picked while it applies, as the value is edited or another cookie opened.
let preferred: ViewId | null = null;

function block(title: string, text: string, copyIndex: number): string {
  return `
    <div class="inspector-block">
      <div class="inspector-block-head">
        <h3>${escapeHtml(title)}</h3>
        <button type="button" class="copy-btn" data-copy="${copyIndex}">${escapeHtml(t('actionCopy'))}</button>
      </div>
      <pre>${escapeHtml(text)}</pre>
    </div>`;
}

function jwtPanel(jwt: JwtView, copies: string[]): string {
  const exp = jwt.times.find((time) => time.claim === 'exp');
  const nbf = jwt.times.find((time) => time.claim === 'nbf');
  let status = `<p class="jwt-status">${escapeHtml(t('jwtNoExpiry'))}</p>`;
  if (jwt.expired && exp) status = `<p class="jwt-status is-expired">${escapeHtml(t('jwtExpired', exp.relative))}</p>`;
  else if (jwt.notYetValid && nbf) status = `<p class="jwt-status is-pending">${escapeHtml(t('jwtNotYetValid', nbf.relative))}</p>`;
  else if (exp) status = `<p class="jwt-status is-valid">${escapeHtml(t('jwtValid', exp.relative))}</p>`;

  const rows = jwt.times.map((time) => `
    <tr>
      <th scope="row">${time.claim}</th>
      <td title="${escapeHtml(time.iso)}">${escapeHtml(new Date(time.seconds * 1000).toLocaleString())}</td>
      <td class="jwt-relative">${escapeHtml(time.relative)}</td>
    </tr>`).join('');

  const header = JSON.stringify(jwt.header, null, 2);
  const payload = typeof jwt.payload === 'string' ? jwt.payload : JSON.stringify(jwt.payload, null, 2);
  copies.push(header, payload);
  return `
    ${status}
    ${rows ? `<table class="jwt-claims">${rows}</table>` : ''}
    ${block(t('inspectorPayload'), payload, 1)}
    ${block(t('inspectorHeader'), header, 0)}
    <p class="inspector-note">${escapeHtml(t('inspectorNotVerified'))}</p>`;
}

export function renderInspector(container: HTMLElement, value: string): void {
  const views = decodeValue(value, Date.now() / 1000);
  const available = VIEW_ORDER.filter((v) => views[v] !== undefined);
  if (available.length === 0) {
    container.hidden = true;
    container.replaceChildren();
    container.onclick = null;
    return;
  }

  const current = preferred && available.includes(preferred) ? preferred : available[0]!;
  const copies: string[] = [];
  let panel = '';
  switch (current) {
    case 'jwt':
      panel = jwtPanel(views.jwt!, copies);
      break;
    case 'json':
      copies.push(views.json!);
      panel = block(t('inspectorPrettyJson'), views.json!, 0);
      break;
    case 'url':
      copies.push(views.url!);
      panel = block(t('inspectorViewUrl'), views.url!, 0);
      break;
    case 'base64':
      copies.push(views.base64!.text);
      panel = block(views.base64!.variant === 'Base64URL' ? t('inspectorBase64UrlDecoded') : t('inspectorBase64Decoded'), views.base64!.text, 0);
      break;
  }

  const tabs = available
    .map((v) => `<button type="button" role="tab" data-view="${v}" aria-selected="${v === current}">${escapeHtml(viewLabel(v))}</button>`)
    .join('');
  container.innerHTML = `
    <div class="inspector-tabs" role="tablist" aria-label="${escapeHtml(t('inspectorTabsLabel'))}">
      ${tabs}
      <span class="inspector-label">${escapeHtml(t('inspectorReadOnly'))}</span>
    </div>
    <div class="inspector-panel" role="tabpanel">${panel}</div>`;
  container.hidden = false;

  container.onclick = async (e) => {
    const target = e.target as HTMLElement;
    const tab = target.closest<HTMLElement>('[data-view]');
    if (tab) {
      preferred = tab.dataset.view as ViewId;
      renderInspector(container, value);
      container.querySelector<HTMLElement>(`[data-view="${preferred}"]`)?.focus();
      return;
    }
    const copy = target.closest<HTMLButtonElement>('[data-copy]');
    if (copy) {
      // Feedback in place: a toast would sit behind the modal editor.
      const ok = await copyText(copies[Number(copy.dataset.copy)] ?? '');
      copy.textContent = ok ? t('inspectorCopied') : t('copyFailed');
      window.setTimeout(() => { copy.textContent = t('actionCopy'); }, 1200);
    }
  };
}
