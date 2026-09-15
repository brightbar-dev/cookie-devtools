import { describe, it, expect } from 'vitest';
import {
  sortCookies, applyChips, matchesChip, chipCounts, shortExpiry, expiryLabel, formatBytes, cookieStats, MAX_COOKIES_PER_DOMAIN,
} from '../utils/list';
import type { CookieLike } from '../utils/cookies';

const NOW = 1_800_000_000;
const c = (over: Partial<CookieLike>): CookieLike => ({
  name: 'n', value: 'v', domain: 'example.com', path: '/', secure: false, httpOnly: false, sameSite: 'lax', session: true, expirationDate: null, ...over,
});

describe('sortCookies', () => {
  const list = [
    c({ name: 'item_10', domain: '.b.com', value: 'xx', session: false, expirationDate: NOW + 300 }),
    c({ name: 'Item_2', domain: 'a.com', value: 'xxxxxx', session: true }),
    c({ name: 'alpha', domain: 'c.com', value: 'x', session: false, expirationDate: NOW + 100 }),
  ];

  it('sorts names naturally and case-insensitively', () => {
    expect(sortCookies(list, 'name').map((x) => x.name)).toEqual(['alpha', 'Item_2', 'item_10']);
    expect(sortCookies(list, 'name', 'desc').map((x) => x.name)).toEqual(['item_10', 'Item_2', 'alpha']);
  });

  it('sorts domains ignoring the leading dot', () => {
    expect(sortCookies(list, 'domain').map((x) => x.domain)).toEqual(['a.com', '.b.com', 'c.com']);
  });

  it('sorts by expiry with session cookies last in both directions', () => {
    expect(sortCookies(list, 'expiry').map((x) => x.name)).toEqual(['alpha', 'item_10', 'Item_2']);
    expect(sortCookies(list, 'expiry', 'desc').map((x) => x.name)).toEqual(['item_10', 'alpha', 'Item_2']);
  });

  it('sorts by size', () => {
    expect(sortCookies(list, 'size', 'desc').map((x) => x.name)).toEqual(['Item_2', 'item_10', 'alpha']);
  });

  it('keeps the original order for ties and does not mutate the input', () => {
    const ties = [c({ name: 'x', path: '/1' }), c({ name: 'x', path: '/2' })];
    expect(sortCookies(ties, 'name').map((x) => x.path)).toEqual(['/1', '/2']);
    const copy = list.slice();
    sortCookies(list, 'size');
    expect(list).toEqual(copy);
  });
});

describe('filter chips', () => {
  const list = [
    c({ name: 'secure_none', secure: true, sameSite: 'no_restriction', session: false, expirationDate: NOW + 1 }),
    c({ name: 'http_session', httpOnly: true }),
    c({ name: 'chips', secure: true, sameSite: 'no_restriction', partitionKey: { topLevelSite: 'https://example.com' } }),
  ];

  it('matches each chip', () => {
    expect(list.filter((x) => matchesChip(x, 'secure')).map((x) => x.name)).toEqual(['secure_none', 'chips']);
    expect(list.filter((x) => matchesChip(x, 'httpOnly')).map((x) => x.name)).toEqual(['http_session']);
    expect(list.filter((x) => matchesChip(x, 'session')).map((x) => x.name)).toEqual(['http_session', 'chips']);
    expect(list.filter((x) => matchesChip(x, 'partitioned')).map((x) => x.name)).toEqual(['chips']);
    expect(list.filter((x) => matchesChip(x, 'sameSiteNone')).map((x) => x.name)).toEqual(['secure_none', 'chips']);
  });

  it('requires every active chip, and passes everything with none', () => {
    expect(applyChips(list, ['secure', 'session']).map((x) => x.name)).toEqual(['chips']);
    expect(applyChips(list, [])).toBe(list);
  });
});

describe('chipCounts', () => {
  it('counts each chip over a list', () => {
    const counts = chipCounts([c({ secure: true }), c({ secure: true, httpOnly: true, session: false, expirationDate: NOW })]);
    expect(counts).toEqual({ secure: 2, httpOnly: 1, session: 1, partitioned: 0, sameSiteNone: 0 });
  });
});

describe('shortExpiry', () => {
  it('uses the largest compact unit', () => {
    const at = (s: number) => shortExpiry(c({ session: false, expirationDate: NOW + s }), NOW);
    expect(shortExpiry(c({ session: true }), NOW)).toBe('Session');
    expect(at(-1)).toBe('Expired');
    expect(at(20)).toBe('1m');
    expect(at(45 * 60)).toBe('45m');
    expect(at(5 * 3600)).toBe('5h');
    expect(at(59.8 * 60)).toBe('1h');
    expect(at(86400 - 60)).toBe('1d');
    expect(at(3 * 86400)).toBe('3d');
    expect(at(400 * 86400)).toBe('1.1y');
    expect(at(730 * 86400)).toBe('2y');
  });
});

describe('expiryLabel', () => {
  it('labels session, expired and relative expiries', () => {
    expect(expiryLabel(c({ session: true }), NOW)).toBe('Session');
    expect(expiryLabel(c({ session: false, expirationDate: NOW - 5 }), NOW)).toBe('Expired');
    expect(expiryLabel(c({ session: false, expirationDate: NOW + 3 * 86400 }), NOW)).toBe('in 3 days');
  });
});

describe('formatBytes', () => {
  it('uses bytes under 1 KB and one decimal under 10 KB', () => {
    expect(formatBytes(812)).toBe('812 B');
    expect(formatBytes(4096)).toBe('4.0 KB');
    expect(formatBytes(20480)).toBe('20 KB');
  });
});

describe('cookieStats', () => {
  it('totals bytes and finds the largest cookie', () => {
    const stats = cookieStats([c({ name: 'a', value: '1234' }), c({ name: 'big', value: 'x'.repeat(100) })]);
    expect(stats).toEqual({ count: 2, totalBytes: 5 + 103, largest: { name: 'big', bytes: 103 }, crowdedDomains: [] });
  });

  it('reports domains over the per-domain cookie limit', () => {
    const many = Array.from({ length: MAX_COOKIES_PER_DOMAIN + 1 }, (_, i) => c({ name: `c${i}`, domain: i % 2 ? '.example.com' : 'example.com' }));
    expect(cookieStats(many).crowdedDomains).toEqual(['example.com']);
    expect(cookieStats([]).largest).toBeNull();
  });
});
