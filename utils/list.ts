// Cookie list: sorting, filter chips, expiry labels and size totals.
import type { CookieLike } from './cookies';
import { cookieSize } from './validate';
import { formatRelative } from './decode';
import { t } from './i18n';

export type SortKey = 'name' | 'domain' | 'expiry' | 'size';
export type Chip = 'secure' | 'httpOnly' | 'session' | 'partitioned' | 'sameSiteNone';

export const CHIPS: Chip[] = ['secure', 'httpOnly', 'session', 'partitioned', 'sameSiteNone'];

export function chipLabel(chip: Chip): string {
  switch (chip) {
    case 'secure': return t('attrSecure');
    case 'httpOnly': return t('attrHttpOnly');
    case 'session': return t('attrSession');
    case 'partitioned': return t('attrPartitioned');
    case 'sameSiteNone': return t('chipSameSiteNone');
  }
}

/** Chrome keeps at most this many cookies per domain before evicting the oldest. */
export const MAX_COOKIES_PER_DOMAIN = 180;

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function expiryRank(c: CookieLike): number {
  return c.session || !c.expirationDate ? Number.POSITIVE_INFINITY : c.expirationDate;
}

export function sortCookies<T extends CookieLike>(cookies: T[], key: SortKey, direction: 'asc' | 'desc' = 'asc'): T[] {
  const sign = direction === 'asc' ? 1 : -1;
  const byName = (a: T, b: T) => collator.compare(a.name, b.name);
  const host = (c: T) => c.domain.replace(/^\./, '');
  const compare = (a: T, b: T): number => {
    switch (key) {
      case 'name':
        return sign * (byName(a, b) || collator.compare(host(a), host(b)));
      case 'domain':
        return sign * (collator.compare(host(a), host(b)) || byName(a, b));
      case 'size':
        return sign * (cookieSize(a.name, a.value) - cookieSize(b.name, b.value)) || byName(a, b);
      case 'expiry': {
        // Session cookies have no expiry to compare, so they go last in either direction.
        const ra = expiryRank(a);
        const rb = expiryRank(b);
        if (ra === rb) return byName(a, b);
        if (ra === Number.POSITIVE_INFINITY) return 1;
        if (rb === Number.POSITIVE_INFINITY) return -1;
        return sign * (ra - rb);
      }
    }
  };
  return cookies
    .map((c, i) => ({ c, i }))
    .sort((x, y) => compare(x.c, y.c) || x.i - y.i)
    .map(({ c }) => c);
}

export function matchesChip(cookie: CookieLike, chip: Chip): boolean {
  switch (chip) {
    case 'secure': return cookie.secure;
    case 'httpOnly': return cookie.httpOnly;
    case 'session': return !!cookie.session || !cookie.expirationDate;
    case 'partitioned': return !!cookie.partitionKey?.topLevelSite;
    case 'sameSiteNone': return cookie.sameSite === 'no_restriction';
  }
}

/** Cookies matching every active chip. */
export function applyChips<T extends CookieLike>(cookies: T[], chips: Iterable<Chip>): T[] {
  const active = [...chips];
  if (active.length === 0) return cookies;
  return cookies.filter((c) => active.every((chip) => matchesChip(c, chip)));
}

export function chipCounts(cookies: CookieLike[]): Record<Chip, number> {
  const counts = Object.fromEntries(CHIPS.map((chip) => [chip, 0])) as Record<Chip, number>;
  for (const c of cookies) for (const chip of CHIPS) if (matchesChip(c, chip)) counts[chip]++;
  return counts;
}

/** Compact expiry for a list row: "Session", "Expired", "45m", "5h", "3d", "1.1y". */
export function shortExpiry(cookie: CookieLike, nowSeconds: number): string {
  if (cookie.session || !cookie.expirationDate) return t('attrSession');
  const left = cookie.expirationDate - nowSeconds;
  if (left <= 0) return t('expiryExpired');
  // Round within each unit and carry, so 23.99 hours reads "1d", not "24h".
  const minutes = Math.round(left / 60);
  if (minutes < 60) return t('expiryShortMinutes', Math.max(1, minutes));
  const hours = Math.round(left / 3600);
  if (hours < 24) return t('expiryShortHours', hours);
  const days = Math.round(left / 86400);
  if (days < 365) return t('expiryShortDays', days);
  return t('expiryShortYears', (left / (365 * 86400)).toFixed(1).replace(/\.0$/, ''));
}

export function expiryLabel(cookie: CookieLike, nowSeconds: number): string {
  if (cookie.session || !cookie.expirationDate) return t('attrSession');
  if (cookie.expirationDate <= nowSeconds) return t('expiryExpired');
  return formatRelative(cookie.expirationDate, nowSeconds);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return t('bytesB', bytes);
  return t('bytesKB', (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0));
}

export interface CookieStats {
  count: number;
  totalBytes: number;
  largest: { name: string; bytes: number } | null;
  /** Domains holding more cookies than the browser keeps. */
  crowdedDomains: string[];
}

export function cookieStats(cookies: CookieLike[]): CookieStats {
  let totalBytes = 0;
  let largest: CookieStats['largest'] = null;
  const perDomain = new Map<string, number>();
  for (const c of cookies) {
    const bytes = cookieSize(c.name, c.value);
    totalBytes += bytes;
    if (!largest || bytes > largest.bytes) largest = { name: c.name, bytes };
    const d = c.domain.replace(/^\./, '');
    perDomain.set(d, (perDomain.get(d) ?? 0) + 1);
  }
  const crowdedDomains = [...perDomain].filter(([, n]) => n > MAX_COOKIES_PER_DOMAIN).map(([d]) => d);
  return { count: cookies.length, totalBytes, largest, crowdedDomains };
}
