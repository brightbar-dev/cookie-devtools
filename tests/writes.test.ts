import { describe, it, expect } from 'vitest';
import {
  toSetDetails, toRemoveDetails, cookieIdentity, shouldRemoveOriginal, isHostOnly, isExpired,
  planRestore, dedupeCookies, partitionSiteCandidates,
} from '../utils/writes';
import type { CookieLike } from '../utils/cookies';

const cookie = (over: Partial<CookieLike> = {}): CookieLike => ({
  name: 'sid',
  value: 'abc',
  domain: 'app.example.com',
  path: '/',
  secure: true,
  httpOnly: true,
  sameSite: 'lax',
  session: false,
  expirationDate: 1900000000,
  storeId: '0',
  hostOnly: true,
  ...over,
});

describe('isHostOnly', () => {
  it('uses the hostOnly flag when present', () => {
    expect(isHostOnly({ hostOnly: false, domain: 'example.com' })).toBe(false);
    expect(isHostOnly({ hostOnly: true, domain: 'example.com' })).toBe(true);
  });

  it('infers it from the leading dot when absent', () => {
    expect(isHostOnly({ domain: '.example.com' })).toBe(false);
    expect(isHostOnly({ domain: 'example.com' })).toBe(true);
  });
});

describe('toSetDetails', () => {
  it('omits domain for a host-only cookie so it stays host-only', () => {
    const d = toSetDetails(cookie());
    expect(d).not.toHaveProperty('domain');
    expect(d.url).toBe('https://app.example.com/');
  });

  it('passes domain for a domain cookie', () => {
    const d = toSetDetails(cookie({ domain: '.example.com', hostOnly: false }));
    expect(d.domain).toBe('.example.com');
    expect(d.url).toBe('https://example.com/');
  });

  it('keeps every attribute', () => {
    expect(toSetDetails(cookie({ path: '/api', sameSite: 'strict' }))).toEqual({
      url: 'https://app.example.com/api',
      name: 'sid',
      value: 'abc',
      path: '/api',
      secure: true,
      httpOnly: true,
      sameSite: 'strict',
      expirationDate: 1900000000,
      storeId: '0',
    });
  });

  it('keeps the fractional expiry the browser reported', () => {
    expect(toSetDetails(cookie({ expirationDate: 1820979829.504634 })).expirationDate).toBe(1820979829.504634);
  });

  it('omits expirationDate for a session cookie', () => {
    expect(toSetDetails(cookie({ session: true })).expirationDate).toBeUndefined();
  });

  it('defaults sameSite to unspecified and path to /', () => {
    const d = toSetDetails(cookie({ sameSite: undefined, path: '' }));
    expect(d.sameSite).toBe('unspecified');
    expect(d.path).toBe('/');
  });

  it('uses http for a non-secure cookie', () => {
    expect(toSetDetails(cookie({ secure: false })).url).toBe('http://app.example.com/');
  });

  it('preserves a non-default cookie store', () => {
    expect(toSetDetails(cookie({ storeId: '1' })).storeId).toBe('1');
  });

  it('preserves the partition key, copied, with a same-site URL on an http loopback site', () => {
    const pk = { topLevelSite: 'http://127.0.0.1', hasCrossSiteAncestor: false };
    const d = toSetDetails(cookie({ domain: '127.0.0.1', partitionKey: pk }));
    expect(d.partitionKey).toEqual(pk);
    expect(d.partitionKey).not.toBe(pk);
    expect(d.url).toBe('http://127.0.0.1/');
  });

  it('uses https for a partitioned cookie from a cross-site frame', () => {
    const d = toSetDetails(cookie({ domain: 'localhost', partitionKey: { topLevelSite: 'http://127.0.0.1', hasCrossSiteAncestor: true } }));
    expect(d.url).toBe('https://localhost/');
  });

  it('never passes an empty partition key', () => {
    expect(toSetDetails(cookie({ partitionKey: {} })).partitionKey).toBeUndefined();
    expect(toSetDetails(cookie({ partitionKey: null })).partitionKey).toBeUndefined();
  });
});

describe('toRemoveDetails', () => {
  it('addresses an unpartitioned cookie by url and name', () => {
    expect(toRemoveDetails(cookie())).toEqual({ url: 'https://app.example.com/', name: 'sid', storeId: '0' });
  });

  it('includes the partition key, without which remove() silently does nothing', () => {
    const pk = { topLevelSite: 'https://example.com', hasCrossSiteAncestor: false };
    expect(toRemoveDetails(cookie({ partitionKey: pk })).partitionKey).toEqual(pk);
  });
});

describe('cookieIdentity', () => {
  const id = cookieIdentity(cookie());

  it('is the same whether hostOnly is explicit or inferred', () => {
    expect(cookieIdentity({ ...cookie(), hostOnly: undefined })).toBe(id);
  });

  it('ignores value, flags and expiry', () => {
    expect(cookieIdentity(cookie({ value: 'x', secure: false, httpOnly: false, sameSite: 'none', expirationDate: 1 }))).toBe(id);
  });

  it('changes with name, path, store, host-only-ness and partition', () => {
    expect(cookieIdentity(cookie({ name: 'sid2' }))).not.toBe(id);
    expect(cookieIdentity(cookie({ path: '/x' }))).not.toBe(id);
    expect(cookieIdentity(cookie({ storeId: '1' }))).not.toBe(id);
    expect(cookieIdentity(cookie({ hostOnly: false }))).not.toBe(id);
    expect(cookieIdentity(cookie({ partitionKey: { topLevelSite: 'https://example.com' } }))).not.toBe(id);
  });

  it('distinguishes partitions by cross-site ancestor', () => {
    const a = cookieIdentity(cookie({ partitionKey: { topLevelSite: 'https://example.com', hasCrossSiteAncestor: false } }));
    const b = cookieIdentity(cookie({ partitionKey: { topLevelSite: 'https://example.com', hasCrossSiteAncestor: true } }));
    expect(a).not.toBe(b);
    expect(cookieIdentity(cookie({ partitionKey: { topLevelSite: 'https://example.com' } }))).toBe(a);
  });

  it('treats a missing store as the default store and domain case-insensitively', () => {
    expect(cookieIdentity(cookie({ storeId: undefined }))).toBe(id);
    expect(cookieIdentity(cookie({ domain: 'App.Example.com' }))).toBe(id);
  });
});

describe('shouldRemoveOriginal', () => {
  it('keeps the original when only the value changed — the write replaced it in place', () => {
    expect(shouldRemoveOriginal(cookie(), cookie({ value: 'new' }), cookie({ value: 'new' }))).toBe(false);
  });

  it('removes the original after a rename', () => {
    expect(shouldRemoveOriginal(cookie(), cookie({ name: 'renamed' }), cookie({ name: 'renamed' }))).toBe(true);
  });

  it('removes the original when a host-only cookie is made a domain cookie', () => {
    const intended = cookie({ hostOnly: false });
    const written = cookie({ hostOnly: false, domain: '.app.example.com' });
    expect(shouldRemoveOriginal(cookie(), intended, written)).toBe(true);
  });

  it('trusts what the browser wrote over what was asked for', () => {
    // On an IP host Chrome stores a requested domain cookie as host-only: the same entry.
    const original = cookie({ domain: '127.0.0.1' });
    const intended = cookie({ domain: '127.0.0.1', hostOnly: false });
    const written = cookie({ domain: '127.0.0.1', hostOnly: true });
    expect(shouldRemoveOriginal(original, intended, written)).toBe(false);
  });

  it('falls back to the intended identity when nothing was written (past expiry)', () => {
    expect(shouldRemoveOriginal(cookie(), cookie({ expirationDate: 1 }), null)).toBe(false);
    expect(shouldRemoveOriginal(cookie(), cookie({ name: 'other', expirationDate: 1 }), null)).toBe(true);
  });
});

describe('isExpired / planRestore', () => {
  const now = 1_800_000_000;

  it('never treats a session cookie as expired', () => {
    expect(isExpired({ session: true, expirationDate: 1 }, now)).toBe(false);
    expect(isExpired({ session: false, expirationDate: null }, now)).toBe(false);
  });

  it('treats an expiry at or before now as expired', () => {
    expect(isExpired({ session: false, expirationDate: now }, now)).toBe(true);
    expect(isExpired({ session: false, expirationDate: now + 1 }, now)).toBe(false);
  });

  it('splits a snapshot into restorable and expired cookies, keeping order', () => {
    const a = cookie({ name: 'a', expirationDate: now + 60 });
    const b = cookie({ name: 'b', expirationDate: now - 60 });
    const c = cookie({ name: 'c', session: true, expirationDate: undefined });
    const plan = planRestore([a, b, c], now);
    expect(plan.toSet.map((x) => x.name)).toEqual(['a', 'c']);
    expect(plan.expired.map((x) => x.name)).toEqual(['b']);
  });
});

describe('dedupeCookies', () => {
  it('keeps the first of each jar entry', () => {
    const list = [cookie({ value: '1' }), cookie({ value: '2' }), cookie({ name: 'other' })];
    expect(dedupeCookies(list).map((c) => c.value)).toEqual(['1', 'abc']);
  });

  it('keeps same-named cookies in different partitions', () => {
    const list = [cookie(), cookie({ partitionKey: { topLevelSite: 'https://example.com' } })];
    expect(dedupeCookies(list)).toHaveLength(2);
  });
});

describe('partitionSiteCandidates', () => {
  it('lists the host and each parent domain', () => {
    expect(partitionSiteCandidates('https://a.b.example.co.uk/path?q=1')).toEqual([
      'https://a.b.example.co.uk',
      'https://b.example.co.uk',
      'https://example.co.uk',
      'https://co.uk',
    ]);
  });

  it('keeps the page scheme and drops the port', () => {
    expect(partitionSiteCandidates('http://dev.app.test:3000/')).toEqual(['http://dev.app.test', 'http://app.test']);
  });

  it('uses the whole host for IP addresses and single-label hosts', () => {
    expect(partitionSiteCandidates('http://127.0.0.1:8771/')).toEqual(['http://127.0.0.1']);
    expect(partitionSiteCandidates('http://localhost:5173/')).toEqual(['http://localhost']);
  });

  it('returns nothing for non-web or invalid URLs', () => {
    expect(partitionSiteCandidates('chrome://extensions/')).toEqual([]);
    expect(partitionSiteCandidates('not a url')).toEqual([]);
  });
});
