// Read-only views of a cookie value: URL-decoded, Base64/Base64URL, JSON and JWT.
// JWTs are decoded only — the signature is never verified.
import { t } from './i18n';

export interface JwtTime {
  claim: 'exp' | 'iat' | 'nbf';
  seconds: number;
  iso: string;
  relative: string;
}

export interface JwtView {
  header: Record<string, unknown>;
  payload: unknown;
  hasSignature: boolean;
  times: JwtTime[];
  expired: boolean;
  notYetValid: boolean;
}

export interface ValueViews {
  url?: string;
  base64?: { variant: 'Base64' | 'Base64URL'; text: string };
  json?: string;
  jwt?: JwtView;
}

// Each unit with how many of it make the next one, so rounding carries: 59.98 minutes is "1 hour".
const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number, number]> = [
  ['second', 1, 60],
  ['minute', 60, 60],
  ['hour', 3600, 24],
  ['day', 86400, 30],
  ['month', 30 * 86400, 12],
  ['year', 365 * 86400, Number.POSITIVE_INFINITY],
];

/** "in 3 days", "2 hours ago" — in the language of the UI strings (localeCode), not the browser's. */
export function formatRelative(targetSeconds: number, nowSeconds: number, locale = t('localeCode')): string {
  const diff = targetSeconds - nowSeconds;
  const fmt = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size, carry] of RELATIVE_UNITS) {
    const n = Math.round(diff / size);
    if (Math.abs(n) < carry) return fmt.format(n, unit);
  }
  return fmt.format(Math.round(diff / (365 * 86400)), 'year');
}

function isReadableText(text: string): boolean {
  if (!text) return false;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffd]/.test(text)) return false;
  const visible = text.replace(/\s/g, '');
  return visible.length > 0;
}

function base64ToText(b64: string): string | null {
  const standard = b64.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (standard.length % 4 === 1) return null;
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    return null;
  }
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function decodeBase64(value: string): ValueViews['base64'] | null {
  const v = value.trim();
  if (v.length < 8) return null;
  const body = v.replace(/=+$/, '');
  // Hex tokens and plain words are valid Base64 alphabets but almost never Base64 data.
  if (/^[0-9a-f]+$/i.test(body) || /^[a-z]+$/i.test(body)) return null;
  let variant: 'Base64' | 'Base64URL';
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(v)) variant = 'Base64';
  else if (/^[A-Za-z0-9_-]+={0,2}$/.test(v)) variant = 'Base64URL';
  else return null;
  const text = base64ToText(v);
  if (text === null || !isReadableText(text)) return null;
  return { variant, text };
}

function parseJsonText(text: string): unknown | undefined {
  const t = text.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

export function decodeJwt(value: string, nowSeconds: number): JwtView | null {
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]*)$/.exec(value.trim());
  if (!m) return null;
  const headerText = base64ToText(m[1]!);
  const payloadText = base64ToText(m[2]!);
  if (headerText === null || payloadText === null) return null;
  const header = parseJsonText(headerText);
  if (!header || typeof header !== 'object' || Array.isArray(header) || !('alg' in header)) return null;
  const payload = parseJsonText(payloadText) ?? payloadText;

  const times: JwtTime[] = [];
  const claims = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  for (const claim of ['exp', 'nbf', 'iat'] as const) {
    const seconds = claims[claim];
    if (typeof seconds === 'number' && Number.isFinite(seconds)) {
      const date = new Date(seconds * 1000);
      if (Number.isNaN(date.getTime())) continue;
      times.push({ claim, seconds, iso: date.toISOString(), relative: formatRelative(seconds, nowSeconds) });
    }
  }
  const exp = claims.exp;
  const nbf = claims.nbf;
  return {
    header: header as Record<string, unknown>,
    payload,
    hasSignature: m[3]!.length > 0,
    times,
    expired: typeof exp === 'number' && exp <= nowSeconds,
    notYetValid: typeof nbf === 'number' && nbf > nowSeconds,
  };
}

/** Every view that applies to a value; the raw value itself is always shown separately. */
export function decodeValue(value: string, nowSeconds: number): ValueViews {
  const views: ValueViews = {};
  let candidate = value;

  if (/%[0-9a-f]{2}/i.test(value)) {
    try {
      const decoded = decodeURIComponent(value);
      if (decoded !== value) {
        views.url = decoded;
        candidate = decoded;
      }
    } catch {
      // malformed escapes: no URL view
    }
  }

  const jwt = decodeJwt(candidate, nowSeconds);
  if (jwt) {
    views.jwt = jwt;
    return views;
  }

  const direct = parseJsonText(candidate);
  if (direct !== undefined) {
    views.json = JSON.stringify(direct, null, 2);
    return views;
  }

  const b64 = decodeBase64(candidate);
  if (b64) {
    views.base64 = b64;
    const inner = parseJsonText(b64.text);
    if (inner !== undefined) views.json = JSON.stringify(inner, null, 2);
  }
  return views;
}
