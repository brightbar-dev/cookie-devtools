// Shared cookie utility functions — extracted for testability

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
}

export function toNetscape(cookies: CookieLike[]): string {
  const lines = ['# Netscape HTTP Cookie File', '# https://curl.se/docs/http-cookies.html', ''];
  for (const c of cookies) {
    const domain = c.domain;
    const flag = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const path = c.path;
    const secure = c.secure ? 'TRUE' : 'FALSE';
    const expiry = c.expirationDate ? Math.floor(c.expirationDate) : 0;
    lines.push(`${domain}\t${flag}\t${path}\t${secure}\t${expiry}\t${c.name}\t${c.value}`);
  }
  return lines.join('\n');
}

export function toCurl(cookies: CookieLike[], url?: string | null): string {
  if (cookies.length === 0) return '# No cookies found';
  const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const targetUrl = url || 'https://example.com';
  return `curl -b '${cookieStr}' '${targetUrl}'`;
}

export function toHeaderString(cookies: CookieLike[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

export function cookieUrl(cookie: Pick<CookieLike, 'secure' | 'domain' | 'path'>): string {
  const protocol = cookie.secure ? 'https' : 'http';
  const domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
  return `${protocol}://${domain}${cookie.path}`;
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
  if (cookie.session) return 'Session';
  if (!cookie.expirationDate) return 'Session';
  const d = new Date(cookie.expirationDate * 1000);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function filterCookies(cookies: CookieLike[], filter: string): CookieLike[] {
  const f = filter.toLowerCase();
  return cookies.filter((c) =>
    c.name.toLowerCase().includes(f) ||
    c.value.toLowerCase().includes(f) ||
    c.domain.toLowerCase().includes(f)
  );
}

export function getBadges(cookie: Pick<CookieLike, 'secure' | 'httpOnly' | 'session' | 'sameSite'>): string[] {
  const badges: string[] = [];
  if (cookie.secure) badges.push('S');
  if (cookie.httpOnly) badges.push('H');
  if (cookie.session) badges.push('Ses');
  const ss = cookie.sameSite;
  if (ss && ss !== 'unspecified') {
    const label = ss === 'no_restriction' ? 'None' : ss.charAt(0).toUpperCase() + ss.slice(1);
    badges.push(label);
  }
  return badges;
}

export function sameSiteLabel(value?: string | null): string | null {
  if (!value || value === 'unspecified') return null;
  return value === 'no_restriction' ? 'None' : value.charAt(0).toUpperCase() + value.slice(1);
}

export interface CookieSetDetails {
  name: string;
  value: string;
  domain: string;
  path?: string | null;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string | null;
  expirationDate?: number | null;
  session?: boolean;
}

export function buildCookieData(details: CookieSetDetails) {
  const protocol = details.secure ? 'https' : 'http';
  const domain = details.domain.startsWith('.') ? details.domain.slice(1) : details.domain;
  const url = `${protocol}://${domain}${details.path || '/'}`;

  const cookieData: Record<string, unknown> = {
    url,
    name: details.name,
    value: details.value,
    domain: details.domain,
    path: details.path || '/',
    secure: !!details.secure,
    httpOnly: !!details.httpOnly,
    sameSite: details.sameSite || 'unspecified',
  };

  if (details.expirationDate && !details.session) {
    cookieData.expirationDate = details.expirationDate;
  }
  return cookieData;
}

export const CAUSE_MAP: Record<string, string> = {
  explicit: 'Set/deleted by page or extension',
  overwrite: 'Overwritten by new value',
  expired: 'Expired',
  evicted: 'Evicted (storage limit)',
  expired_overwrite: 'Expired and overwritten',
};
