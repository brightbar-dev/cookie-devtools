// Import: recognise a pasted or opened cookie export, turn it into cookies the browser can set,
// and say before anything is written what will be created and what will be skipped, and why.
import { cookieHost } from './cookies';
import type { CookieLike, PartitionKey } from './cookies';
import { validateCookie } from './validate';
import { cookieIdentity } from './writes';

export type ImportFormat =
  | 'cookie-json'
  | 'editthiscookie-json'
  | 'playwright-json'
  | 'netscape'
  | 'header'
  | 'set-cookie'
  | 'curl'
  | 'unknown';

export const FORMAT_LABELS: Record<ImportFormat, string> = {
  'cookie-json': 'JSON cookie list (Cookie DevTools, Cookie-Editor)',
  'editthiscookie-json': 'EditThisCookie JSON',
  'playwright-json': 'Playwright / Puppeteer cookies',
  netscape: 'Netscape cookies.txt',
  header: 'Cookie header',
  'set-cookie': 'Set-Cookie headers',
  curl: 'curl command',
  unknown: 'Unrecognised format',
};

export interface ImportContext {
  /** The page cookies without their own domain (a Cookie header, say) are imported for. */
  url: string;
  nowSeconds: number;
}

export interface SkippedImport {
  name: string;
  reason: string;
}

export interface ImportPlan {
  format: ImportFormat;
  cookies: CookieLike[];
  skipped: SkippedImport[];
  error?: string;
}

type Candidate = CookieLike | SkippedImport;

function isSkip(c: Candidate): c is SkippedImport {
  return 'reason' in c;
}

function pageInfo(url: string): { host: string; https: boolean } {
  try {
    const u = new URL(url);
    return { host: u.hostname, https: u.protocol === 'https:' };
  } catch {
    return { host: '', https: false };
  }
}

function jsonCookieArray(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.cookies)) return obj.cookies; // Playwright storageState, profile-like wrappers
    if (typeof obj.name === 'string' && 'value' in obj) return [obj];
  }
  return null;
}

export function detectFormat(text: string): ImportFormat {
  const t = text.trim();
  if (!t) return 'unknown';
  if (t.startsWith('[') || t.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(t);
    } catch {
      return 'unknown';
    }
    const list = jsonCookieArray(parsed);
    if (!list) return 'unknown';
    const entries = list.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object');
    if (entries.some((e) => typeof e.id === 'number')) return 'editthiscookie-json';
    if (entries.some((e) => typeof e.expires === 'number' && !('expirationDate' in e))) return 'playwright-json';
    return 'cookie-json';
  }
  if (/^curl\s/i.test(t)) return 'curl';
  const lines = t.split(/\r?\n/);
  if (lines.some((l) => /^set-cookie\s*:/i.test(l.trim()))) return 'set-cookie';
  if (/netscape http cookie file/i.test(lines[0] ?? '') || lines.some((l) => l.startsWith('#HttpOnly_') || l.split('\t').length >= 7)) {
    return 'netscape';
  }
  if (/^(cookie\s*:\s*)?[^=;\s][^=;]*=/i.test(t)) return 'header';
  return 'unknown';
}

export function normalizeSameSite(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (s === 'no_restriction' || s === 'none') return 'no_restriction';
  if (s === 'lax' || s === 'strict') return s;
  return 'unspecified';
}

function readPartitionKey(raw: unknown): PartitionKey | null {
  if (!raw || typeof raw !== 'object') return null;
  const pk = raw as Record<string, unknown>;
  if (typeof pk.topLevelSite !== 'string' || !pk.topLevelSite) return null;
  const key: PartitionKey = { topLevelSite: pk.topLevelSite };
  if (typeof pk.hasCrossSiteAncestor === 'boolean') key.hasCrossSiteAncestor = pk.hasCrossSiteAncestor;
  return key;
}

/** Seconds since the epoch; exports in milliseconds are recognised by size. */
function toSeconds(n: number): number {
  return n > 1e11 ? n / 1000 : n;
}

function fromJsonEntry(entry: unknown, index: number, ctx: ImportContext): Candidate {
  if (!entry || typeof entry !== 'object') return { name: `entry ${index + 1}`, reason: 'not a cookie object' };
  const o = entry as Record<string, unknown>;
  if (typeof o.name !== 'string') return { name: `entry ${index + 1}`, reason: 'has no name' };

  const page = pageInfo(ctx.url);
  let domain = typeof o.domain === 'string' && o.domain ? o.domain.trim() : page.host;
  if (!domain) return { name: o.name, reason: 'has no domain, and there is no current site to use' };
  const hostOnly = typeof o.hostOnly === 'boolean' ? o.hostOnly : !domain.startsWith('.');
  domain = hostOnly ? cookieHost(domain) : '.' + cookieHost(domain);

  const rawExpiry = [o.expirationDate, o.expires, o.expiry].find((v) => typeof v === 'number') as number | undefined;
  const session = o.session === true || rawExpiry === undefined || rawExpiry <= 0;

  return {
    name: o.name,
    value: typeof o.value === 'string' ? o.value : o.value == null ? '' : String(o.value),
    domain,
    hostOnly,
    path: typeof o.path === 'string' && o.path ? o.path : '/',
    secure: o.secure === true,
    httpOnly: o.httpOnly === true,
    sameSite: normalizeSameSite(o.sameSite),
    session,
    expirationDate: session ? null : toSeconds(rawExpiry!),
    partitionKey: readPartitionKey(o.partitionKey),
  };
}

function parseJson(text: string, ctx: ImportContext): Candidate[] | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return `Not valid JSON: ${(err as Error).message}`;
  }
  const list = jsonCookieArray(parsed);
  if (!list) return 'JSON, but not a list of cookies.';
  return list.map((entry, i) => fromJsonEntry(entry, i, ctx));
}

function parseNetscape(text: string): Candidate[] {
  const out: Candidate[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    let line = raw;
    let httpOnly = false;
    if (line.startsWith('#HttpOnly_')) {
      httpOnly = true;
      line = line.slice('#HttpOnly_'.length);
    } else if (!line.trim() || line.startsWith('#')) {
      return;
    }
    const fields = line.split('\t');
    if (fields.length < 7) {
      out.push({ name: `line ${i + 1}`, reason: 'is not 7 tab-separated fields' });
      return;
    }
    const [domainField, includeSubdomains, path, secure, expires, name, ...valueParts] = fields as [string, string, string, string, string, string, ...string[]];
    const hostOnly = includeSubdomains.toUpperCase() !== 'TRUE';
    const expiry = Number(expires);
    const session = !(expiry > 0);
    out.push({
      name,
      value: valueParts.join('\t'),
      domain: hostOnly ? cookieHost(domainField) : '.' + cookieHost(domainField),
      hostOnly,
      path: path || '/',
      secure: secure.toUpperCase() === 'TRUE',
      httpOnly,
      sameSite: 'unspecified',
      session,
      expirationDate: session ? null : expiry,
    });
  });
  return out;
}

function pairsToCookies(pairs: string, ctx: ImportContext, host?: string): Candidate[] {
  const page = pageInfo(ctx.url);
  const domain = host || page.host;
  const out: Candidate[] = [];
  for (const part of pairs.split(';')) {
    const piece = part.trim();
    if (!piece) continue;
    const eq = piece.indexOf('=');
    if (eq < 0) {
      out.push({ name: piece, reason: 'has no “=”, so it is not a name=value pair' });
      continue;
    }
    if (!domain) {
      out.push({ name: piece.slice(0, eq).trim(), reason: 'there is no current site to import it for' });
      continue;
    }
    out.push({
      name: piece.slice(0, eq).trim(),
      value: piece.slice(eq + 1).trim(),
      domain,
      hostOnly: true,
      path: '/',
      secure: page.https,
      httpOnly: false,
      sameSite: 'unspecified',
      session: true,
      expirationDate: null,
    });
  }
  return out;
}

function parseHeader(text: string, ctx: ImportContext): Candidate[] {
  const joined = text
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^cookie\s*:\s*/i, ''))
    .filter(Boolean)
    .join('; ');
  return pairsToCookies(joined, ctx);
}

export function parseSetCookie(header: string, ctx: ImportContext): Candidate {
  const page = pageInfo(ctx.url);
  const [first = '', ...attrs] = header.replace(/^set-cookie\s*:\s*/i, '').split(';');
  const eq = first.indexOf('=');
  if (eq < 0) return { name: first.trim() || '(empty)', reason: 'has no “=”, so it is not a name=value pair' };
  const cookie: CookieLike = {
    name: first.slice(0, eq).trim(),
    value: first.slice(eq + 1).trim(),
    domain: page.host,
    hostOnly: true,
    path: '/',
    secure: false,
    httpOnly: false,
    sameSite: 'unspecified',
    session: true,
    expirationDate: null,
  };
  let maxAge: number | null = null;
  let expires: number | null = null;
  for (const attr of attrs) {
    const [rawKey = '', ...rest] = attr.split('=');
    const key = rawKey.trim().toLowerCase();
    const val = rest.join('=').trim();
    if (key === 'domain' && val) {
      cookie.domain = '.' + cookieHost(val);
      cookie.hostOnly = false;
    } else if (key === 'path' && val) cookie.path = val;
    else if (key === 'secure') cookie.secure = true;
    else if (key === 'httponly') cookie.httpOnly = true;
    else if (key === 'samesite') cookie.sameSite = normalizeSameSite(val);
    else if (key === 'max-age' && /^-?\d+$/.test(val)) maxAge = parseInt(val, 10);
    else if (key === 'expires') {
      const t = Date.parse(val);
      if (!Number.isNaN(t)) expires = t / 1000;
    } else if (key === 'partitioned') {
      return { name: cookie.name, reason: 'is Partitioned, and a header does not say which top-level site it belongs to — import it from a JSON export instead' };
    }
  }
  if (!cookie.domain) return { name: cookie.name, reason: 'has no Domain, and there is no current site to use' };
  // Max-Age wins over Expires (RFC 6265 §5.3).
  const expiry = maxAge !== null ? ctx.nowSeconds + maxAge : expires;
  if (expiry !== null) {
    cookie.session = false;
    cookie.expirationDate = expiry;
  }
  return cookie;
}

function parseSetCookieLines(text: string, ctx: ImportContext): Candidate[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^set-cookie\s*:/i.test(l))
    .map((l) => parseSetCookie(l, ctx));
}

/** Every argument given to a curl flag, unquoted (single, double or bare). */
function shellArgs(text: string, flag: RegExp): string[] {
  const re = new RegExp(`(?:^|\\s)(?:${flag.source})\\s+(?:'([^']*)'|"((?:[^"\\\\]|\\\\.)*)"|(\\S+))`, 'gi');
  return [...text.matchAll(re)].map((m) => m[1] ?? (m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : m[3] ?? ''));
}

const QUOTE_PLACEHOLDER = '\u0000';

function parseCurl(text: string, ctx: ImportContext): Candidate[] | string {
  // Join continuation lines, and hold the shell's '\'' (a quote inside single quotes) aside.
  const oneLine = text.replace(/\\\r?\n/g, ' ').replace(/'\\''/g, QUOTE_PLACEHOLDER);
  const urlMatch = /(?:'|")?(https?:\/\/[^\s'"]+)/i.exec(oneLine);
  const host = urlMatch ? pageInfo(urlMatch[1]!).host : undefined;
  const fromFlag = shellArgs(oneLine, /-b|--cookie/)[0] ?? null;
  const cookieHeader = shellArgs(oneLine, /-H|--header/).find((h) => /^cookie\s*:/i.test(h));
  const fromHeader = cookieHeader ? cookieHeader.replace(/^cookie\s*:\s*/i, '') : null;
  const pairs = (fromFlag ?? fromHeader)?.split(QUOTE_PLACEHOLDER).join("'");
  if (!pairs) return 'A curl command, but it has no -b/--cookie or Cookie header.';
  if (!pairs.includes('=')) return `curl reads cookies from the file “${pairs}” here — open that file instead.`;
  return pairsToCookies(pairs, ctx, host);
}

function toDraftIssues(cookie: CookieLike, nowSeconds: number) {
  return validateCookie({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    hostOnly: !!cookie.hostOnly,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite || 'unspecified',
    session: !!cookie.session,
    expirationDate: cookie.session ? null : cookie.expirationDate ?? null,
    partitioned: !!cookie.partitionKey?.topLevelSite,
  }, { nowSeconds, allowEmptyName: true });
}

/** Parse, normalise and check an import without writing anything. */
export function planImport(text: string, ctx: ImportContext): ImportPlan {
  const format = detectFormat(text);
  let candidates: Candidate[] | string;
  switch (format) {
    case 'cookie-json':
    case 'editthiscookie-json':
    case 'playwright-json':
      candidates = parseJson(text.trim(), ctx);
      break;
    case 'netscape':
      candidates = parseNetscape(text);
      break;
    case 'header':
      candidates = parseHeader(text, ctx);
      break;
    case 'set-cookie':
      candidates = parseSetCookieLines(text, ctx);
      break;
    case 'curl':
      candidates = parseCurl(text, ctx);
      break;
    default: {
      const t = text.trim();
      let error = 'Not a format this can read: JSON, Netscape cookies.txt, a Cookie or Set-Cookie header, or a curl command.';
      if (!t) {
        error = 'Paste an export or open a file.';
      } else if (t.startsWith('[') || t.startsWith('{')) {
        const parsed = parseJson(t, ctx);
        error = typeof parsed === 'string' ? parsed : 'JSON, but not a list of cookies.';
      }
      return { format, cookies: [], skipped: [], error };
    }
  }
  if (typeof candidates === 'string') return { format, cookies: [], skipped: [], error: candidates };

  const skipped: SkippedImport[] = [];
  const valid: CookieLike[] = [];
  for (const c of candidates) {
    if (isSkip(c)) {
      skipped.push(c);
      continue;
    }
    const issues = toDraftIssues(c, ctx.nowSeconds);
    const error = issues.find((i) => i.severity === 'error');
    if (error) {
      skipped.push({ name: c.name, reason: error.message });
    } else if (issues.some((i) => i.code === 'expiry-past')) {
      skipped.push({ name: c.name, reason: 'has already expired' });
    } else {
      valid.push(c);
    }
  }

  // The same cookie twice: the later entry wins, as it would if both were set in order.
  const lastIndex = new Map<string, number>();
  valid.forEach((c, i) => lastIndex.set(cookieIdentity(c), i));
  const cookies = valid.filter((c, i) => {
    if (lastIndex.get(cookieIdentity(c)) === i) return true;
    skipped.push({ name: c.name, reason: 'appears again later in the import' });
    return false;
  });

  return { format, cookies, skipped };
}

/** How many planned cookies are new and how many replace a cookie that exists now. */
export function compareWithExisting(planned: CookieLike[], existing: CookieLike[]): { create: number; replace: number } {
  const ids = new Set(existing.map((c) => cookieIdentity(c)));
  let replace = 0;
  for (const c of planned) if (ids.has(cookieIdentity(c))) replace++;
  return { create: planned.length - replace, replace };
}
