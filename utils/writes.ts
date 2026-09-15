// Planning for cookie writes: what to pass chrome.cookies.set/remove so a cookie keeps its
// identity and flags, and when an edit may remove the original. Pure, so it is unit-tested.
import { cookieUrl, cookieHost, type CookieLike, type PartitionKey } from './cookies';

export interface SetDetails {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  expirationDate?: number;
  storeId?: string;
  partitionKey?: PartitionKey;
}

export interface RemoveDetails {
  url: string;
  name: string;
  storeId?: string;
  partitionKey?: PartitionKey;
}

/**
 * A cookie from chrome.cookies carries hostOnly; one typed or imported may not. Chrome writes a
 * domain cookie's domain with a leading dot and a host-only cookie's without, so the dot decides.
 */
export function isHostOnly(cookie: Pick<CookieLike, 'hostOnly' | 'domain'>): boolean {
  return cookie.hostOnly ?? !cookie.domain.startsWith('.');
}

/** The chrome.cookies.set details that recreate `cookie` exactly — same host-only-ness, store and partition. */
export function toSetDetails(cookie: CookieLike): SetDetails {
  const details: SetDetails = {
    url: cookieUrl(cookie),
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || '/',
    secure: !!cookie.secure,
    httpOnly: !!cookie.httpOnly,
    sameSite: cookie.sameSite || 'unspecified',
  };
  // Passing `domain` is what makes a cookie a domain cookie; a host-only cookie must omit it.
  if (!isHostOnly(cookie)) details.domain = cookie.domain;
  if (!cookie.session && cookie.expirationDate) details.expirationDate = cookie.expirationDate;
  if (cookie.storeId) details.storeId = cookie.storeId;
  if (cookie.partitionKey?.topLevelSite) details.partitionKey = { ...cookie.partitionKey };
  return details;
}

/** remove() silently does nothing to a partitioned cookie unless its partitionKey is passed. */
export function toRemoveDetails(cookie: CookieLike): RemoveDetails {
  const details: RemoveDetails = { url: cookieUrl(cookie), name: cookie.name };
  if (cookie.storeId) details.storeId = cookie.storeId;
  if (cookie.partitionKey?.topLevelSite) details.partitionKey = { ...cookie.partitionKey };
  return details;
}

/** The fields that make two cookies the same jar entry: store, domain (dot = domain cookie), path, name, partition. */
export function cookieIdentity(cookie: Pick<CookieLike, 'name' | 'domain' | 'path' | 'storeId' | 'partitionKey' | 'hostOnly'>): string {
  const pk = cookie.partitionKey;
  const partition = pk?.topLevelSite ? `${pk.topLevelSite}|${pk.hasCrossSiteAncestor ? 1 : 0}` : '';
  const domain = isHostOnly(cookie) ? cookieHost(cookie.domain) : '.' + cookieHost(cookie.domain);
  return [cookie.storeId || '0', domain.toLowerCase(), cookie.path || '/', cookie.name, partition].join('\u001f');
}

/**
 * After an edit's set() succeeded, the original entry is removed only when the write landed in a
 * different jar entry (renamed, moved, re-partitioned). Removing it otherwise would delete the
 * cookie that was just written. `written` is what set() returned; Chrome returns nothing when the
 * new expiry is in the past, and then the intended identity stands in for it.
 */
export function shouldRemoveOriginal(original: CookieLike, intended: CookieLike, written?: CookieLike | null): boolean {
  return cookieIdentity(written || intended) !== cookieIdentity(original);
}

export function isExpired(cookie: Pick<CookieLike, 'session' | 'expirationDate'>, nowSeconds: number): boolean {
  return !cookie.session && !!cookie.expirationDate && cookie.expirationDate <= nowSeconds;
}

/** Split a snapshot into what can be restored and what has expired since it was taken. */
export function planRestore<T extends CookieLike>(cookies: T[], nowSeconds: number): { toSet: T[]; expired: T[] } {
  const toSet: T[] = [];
  const expired: T[] = [];
  for (const c of cookies) (isExpired(c, nowSeconds) ? expired : toSet).push(c);
  return { toSet, expired };
}

export function dedupeCookies<T extends CookieLike>(cookies: T[]): T[] {
  const seen = new Set<string>();
  return cookies.filter((c) => {
    const id = cookieIdentity(c);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * Top-level sites a page on `pageUrl` can be partitioned under. A site is scheme + registrable
 * domain, which is always the host or one of its parents, so without a public-suffix list every
 * dotted suffix is a candidate; Chrome returns nothing for the ones that are not real sites.
 */
export function partitionSiteCandidates(pageUrl: string): string[] {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return [];
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return [];
  const host = url.hostname;
  const scheme = url.protocol.slice(0, -1);
  if (/^[\d.]+$/.test(host) || host.startsWith('[') || !host.includes('.')) return [`${scheme}://${host}`];
  const labels = host.split('.');
  const out: string[] = [];
  for (let i = 0; i < labels.length - 1; i++) out.push(`${scheme}://${labels.slice(i).join('.')}`);
  return out;
}
