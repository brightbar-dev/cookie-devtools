// Shared cookie utility functions — extracted for testability
import { t } from './i18n';

export interface PartitionKey {
  topLevelSite?: string;
  hasCrossSiteAncestor?: boolean;
}

export interface CookieLike {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: string;
  expirationDate?: number | null;
  session?: boolean;
  storeId?: string;
  hostOnly?: boolean;
  partitionKey?: PartitionKey | null;
}

export function toNetscape(cookies: CookieLike[]): string {
  const lines = ['# Netscape HTTP Cookie File', '# https://curl.se/docs/http-cookies.html', ''];
  for (const c of cookies) {
    const domain = c.domain;
    const flag = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const path = c.path;
    const secure = c.secure ? 'TRUE' : 'FALSE';
    const expiry = c.expirationDate ? Math.floor(c.expirationDate) : 0;
    // curl's convention for HttpOnly cookies, so they survive a round trip.
    const prefix = c.httpOnly ? '#HttpOnly_' : '';
    lines.push(`${prefix}${domain}\t${flag}\t${path}\t${secure}\t${expiry}\t${c.name}\t${c.value}`);
  }
  return lines.join('\n');
}

export function toCurl(cookies: CookieLike[], url?: string | null): string {
  if (cookies.length === 0) return '# No cookies found';
  const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const targetUrl = url || 'https://example.com';
  return `curl -b ${shellQuote(cookieStr)} ${shellQuote(targetUrl)}`;
}

/** Single-quote for a POSIX shell; a ' inside becomes '\''. */
export function shellQuote(str: string): string {
  return `'${str.replace(/'/g, `'\\''`)}'`;
}

export function toHeaderString(cookies: CookieLike[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

export function cookieHost(domain: string): string {
  return domain.startsWith('.') ? domain.slice(1) : domain;
}

/** True when a cookie on `cookieDomain` is sent to `host`: the same host or a parent domain. */
export function domainAppliesToHost(cookieDomain: string, host: string): boolean {
  const d = cookieHost(cookieDomain).toLowerCase();
  const h = host.toLowerCase();
  return !!d && (h === d || h.endsWith('.' + d));
}

export function isPartitioned(cookie: Pick<CookieLike, 'partitionKey'>): boolean {
  return !!cookie.partitionKey?.topLevelSite;
}

/**
 * The URL chrome.cookies.set/remove need to address a cookie. Secure cookies use https,
 * except a partitioned cookie with no cross-site ancestor: Chrome requires that URL to be
 * same-site with the top-level site, and on a loopback dev server that site is http://.
 */
export function cookieUrl(cookie: Pick<CookieLike, 'secure' | 'domain' | 'path'> & { partitionKey?: PartitionKey | null }): string {
  const host = cookieHost(cookie.domain);
  let protocol = cookie.secure ? 'https' : 'http';
  const pk = cookie.partitionKey;
  if (pk?.topLevelSite && !pk.hasCrossSiteAncestor) {
    try {
      const site = new URL(pk.topLevelSite);
      if (host === site.hostname || host.endsWith('.' + site.hostname)) {
        protocol = site.protocol.replace(':', '');
      }
    } catch {
      // not a URL; keep the default scheme
    }
  }
  return `${protocol}://${host}${cookie.path || '/'}`;
}

export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatExpiry(cookie: Pick<CookieLike, 'session' | 'expirationDate'>): string {
  if (cookie.session) return t('attrSession');
  if (!cookie.expirationDate) return t('attrSession');
  const d = new Date(cookie.expirationDate * 1000);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Epoch seconds → the local-time "YYYY-MM-DDTHH:MM" string a datetime-local input expects. */
export function toDatetimeLocal(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A datetime-local value (local time, no zone) → epoch seconds, or null when blank/invalid. */
export function fromDatetimeLocal(value: string): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t / 1000;
}

export function filterCookies<T extends CookieLike>(cookies: T[], filter: string): T[] {
  const f = filter.toLowerCase();
  return cookies.filter((c) =>
    c.name.toLowerCase().includes(f) ||
    c.value.toLowerCase().includes(f) ||
    c.domain.toLowerCase().includes(f)
  );
}

export interface Badge {
  label: string;
  kind: string;
  title: string;
}

export function cookieBadges(cookie: Pick<CookieLike, 'secure' | 'httpOnly' | 'session' | 'sameSite' | 'partitionKey'>): Badge[] {
  const badges: Badge[] = [];
  if (cookie.secure) badges.push({ label: t('badgeSecure'), kind: 'secure', title: t('badgeSecureTitle') });
  if (cookie.httpOnly) badges.push({ label: t('badgeHttpOnly'), kind: 'httponly', title: t('badgeHttpOnlyTitle') });
  if (cookie.session) badges.push({ label: t('badgeSession'), kind: 'session', title: t('badgeSessionTitle') });
  const ss = sameSiteLabel(cookie.sameSite);
  if (ss) badges.push({ label: ss, kind: `samesite-${cookie.sameSite}`, title: `SameSite=${ss}` });
  const pk = cookie.partitionKey;
  if (pk?.topLevelSite) {
    const title = pk.hasCrossSiteAncestor ? t('badgePartitionedCrossSiteTitle', pk.topLevelSite) : t('badgePartitionedFirstPartyTitle', pk.topLevelSite);
    badges.push({ label: t('badgePartitioned'), kind: 'partitioned', title });
  }
  return badges;
}

export function getBadges(cookie: Pick<CookieLike, 'secure' | 'httpOnly' | 'session' | 'sameSite' | 'partitionKey'>): string[] {
  return cookieBadges(cookie).map((b) => b.label);
}

export function sameSiteLabel(value?: string | null): string | null {
  if (!value || value === 'unspecified') return null;
  return value === 'no_restriction' ? 'None' : value.charAt(0).toUpperCase() + value.slice(1);
}

export const CHANGE_CAUSES = ['explicit', 'overwrite', 'expired', 'evicted', 'expired_overwrite'] as const;

/** What a cookies.onChanged cause means, for the Monitor; unknown causes are shown as given. */
export function causeLabel(cause: string): string {
  switch (cause) {
    case 'explicit': return t('causeExplicit');
    case 'overwrite': return t('causeOverwrite');
    case 'expired': return t('expiryExpired');
    case 'evicted': return t('causeEvicted');
    case 'expired_overwrite': return t('causeExpiredOverwrite');
    default: return cause;
  }
}
