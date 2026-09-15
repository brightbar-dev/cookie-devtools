import { describe, it, expect } from 'vitest';
import { detectFormat, planImport, parseSetCookie, compareWithExisting, normalizeSameSite } from '../utils/importer';
import type { ImportContext } from '../utils/importer';
import { toNetscape, toCurl, toHeaderString } from '../utils/cookies';
import type { CookieLike } from '../utils/cookies';

const NOW = 1_800_000_000;
const ctx: ImportContext = { url: 'https://app.example.com/dashboard', nowSeconds: NOW };

describe('detectFormat', () => {
  it('recognises each supported format', () => {
    expect(detectFormat('[{"name":"a","value":"1","domain":".example.com"}]')).toBe('cookie-json');
    expect(detectFormat('[{"id":1,"name":"a","value":"1","domain":"example.com","storeId":"0"}]')).toBe('editthiscookie-json');
    expect(detectFormat('{"cookies":[{"name":"a","value":"1","domain":"x.com","path":"/","expires":-1}],"origins":[]}')).toBe('playwright-json');
    expect(detectFormat('# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tFALSE\t0\ta\t1')).toBe('netscape');
    expect(detectFormat('#HttpOnly_example.com\tFALSE\t/\tTRUE\t0\tsid\tx')).toBe('netscape');
    expect(detectFormat('Cookie: a=1; b=2')).toBe('header');
    expect(detectFormat('a=1; b=2')).toBe('header');
    expect(detectFormat('Set-Cookie: sid=abc; Path=/; HttpOnly')).toBe('set-cookie');
    expect(detectFormat("curl -b 'a=1' 'https://example.com'")).toBe('curl');
  });

  it('returns unknown for blank, prose and JSON that is not cookies', () => {
    expect(detectFormat('   ')).toBe('unknown');
    expect(detectFormat('hello world')).toBe('unknown');
    expect(detectFormat('{"foo": 1}')).toBe('unknown');
    expect(detectFormat('[{"name": ')).toBe('unknown');
  });
});

describe('planImport — JSON', () => {
  it('reads a Cookie-Editor style list (no storeId, sameSite null, domain cookie)', () => {
    const text = JSON.stringify([{
      domain: '.example.com', expirationDate: NOW + 3600.5, hostOnly: false, httpOnly: true, name: 'sid',
      path: '/', sameSite: null, secure: true, session: false, storeId: null, value: 'abc',
    }]);
    const plan = planImport(text, ctx);
    expect(plan.format).toBe('cookie-json');
    expect(plan.skipped).toEqual([]);
    expect(plan.cookies).toEqual([{
      name: 'sid', value: 'abc', domain: '.example.com', hostOnly: false, path: '/', secure: true, httpOnly: true,
      sameSite: 'unspecified', session: false, expirationDate: NOW + 3600.5, partitionKey: null,
    }]);
  });

  it('reads an EditThisCookie list and drops its store id', () => {
    const text = JSON.stringify([{ id: 1, name: 'pref', value: 'dark', domain: 'app.example.com', hostOnly: true, path: '/', secure: false, httpOnly: false, sameSite: 'lax', session: true, storeId: '1' }]);
    const plan = planImport(text, ctx);
    expect(plan.format).toBe('editthiscookie-json');
    expect(plan.cookies[0]).toMatchObject({ name: 'pref', domain: 'app.example.com', hostOnly: true, sameSite: 'lax', session: true });
    expect(plan.cookies[0]).not.toHaveProperty('storeId');
  });

  it('reads Playwright storageState cookies (expires -1 = session, capitalised SameSite)', () => {
    const text = JSON.stringify({ cookies: [
      { name: 'a', value: '1', domain: '.example.com', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'None' },
      { name: 'b', value: '2', domain: 'app.example.com', path: '/', expires: NOW + 60, httpOnly: true, secure: false, sameSite: 'Lax' },
    ], origins: [] });
    const plan = planImport(text, ctx);
    expect(plan.format).toBe('playwright-json');
    expect(plan.cookies.map((c) => [c.name, c.session, c.sameSite, c.hostOnly])).toEqual([
      ['a', true, 'no_restriction', false],
      ['b', false, 'lax', true],
    ]);
  });

  it('keeps a partition key', () => {
    const pk = { topLevelSite: 'https://example.com', hasCrossSiteAncestor: false };
    const plan = planImport(JSON.stringify([{ name: 'p', value: '1', domain: 'app.example.com', secure: true, sameSite: 'no_restriction', partitionKey: pk }]), ctx);
    expect(plan.cookies[0]!.partitionKey).toEqual(pk);
  });

  it('treats a millisecond expiry as milliseconds', () => {
    const plan = planImport(JSON.stringify([{ name: 'a', value: '1', domain: 'example.com', expirationDate: (NOW + 100) * 1000 }]), ctx);
    expect(plan.cookies[0]!.expirationDate).toBe(NOW + 100);
  });

  it('uses the current site when an entry has no domain', () => {
    const plan = planImport('{"name":"solo","value":"1"}', ctx);
    expect(plan.cookies[0]).toMatchObject({ domain: 'app.example.com', hostOnly: true });
  });

  it('skips, with reasons and in file order, entries the browser would reject or that already expired', () => {
    const text = JSON.stringify([
      { name: 'ok', value: '1', domain: 'example.com' },
      { name: 'none_insecure', value: '1', domain: 'example.com', sameSite: 'no_restriction', secure: false },
      { name: 'old', value: '1', domain: 'example.com', expirationDate: NOW - 10 },
      { value: 'no name' },
      'not an object',
    ]);
    const plan = planImport(text, ctx);
    expect(plan.cookies.map((c) => c.name)).toEqual(['ok']);
    expect(plan.skipped).toEqual([
      { name: 'none_insecure', reason: 'SameSite=None requires Secure.' },
      { name: 'old', reason: 'has already expired' },
      { name: 'entry 4', reason: 'has no name' },
      { name: 'entry 5', reason: 'not a cookie object' },
    ]);
  });

  it('keeps the later of two entries for the same cookie', () => {
    const text = JSON.stringify([
      { name: 'a', value: 'first', domain: 'example.com' },
      { name: 'a', value: 'second', domain: 'example.com' },
    ]);
    const plan = planImport(text, ctx);
    expect(plan.cookies.map((c) => c.value)).toEqual(['second']);
    expect(plan.skipped).toEqual([{ name: 'a', reason: 'appears again later in the import' }]);
  });

  it('explains invalid JSON', () => {
    const plan = planImport('[{"name": "a",', ctx);
    expect(plan.format).toBe('unknown');
    expect(plan.error).toMatch(/^Not valid JSON/);
  });
});

describe('planImport — Netscape', () => {
  it('reads domain and host-only lines, #HttpOnly_ and session entries', () => {
    const text = [
      '# Netscape HTTP Cookie File',
      '',
      '.example.com\tTRUE\t/\tTRUE\t1900000000\tsid\tabc',
      '#HttpOnly_app.example.com\tFALSE\t/api\tFALSE\t0\ttoken\tt w',
      'broken line',
    ].join('\n');
    const plan = planImport(text, ctx);
    expect(plan.format).toBe('netscape');
    expect(plan.cookies).toEqual([
      { name: 'sid', value: 'abc', domain: '.example.com', hostOnly: false, path: '/', secure: true, httpOnly: false, sameSite: 'unspecified', session: false, expirationDate: 1900000000 },
      { name: 'token', value: 't w', domain: 'app.example.com', hostOnly: true, path: '/api', secure: false, httpOnly: true, sameSite: 'unspecified', session: true, expirationDate: null },
    ]);
    expect(plan.skipped).toEqual([{ name: 'line 5', reason: 'is not 7 tab-separated fields' }]);
  });
});

describe('planImport — headers', () => {
  it('applies a Cookie header to the current site', () => {
    const plan = planImport('Cookie: a=1; b=x=y;  ; flag', ctx);
    expect(plan.format).toBe('header');
    expect(plan.cookies).toEqual([
      { name: 'a', value: '1', domain: 'app.example.com', hostOnly: true, path: '/', secure: true, httpOnly: false, sameSite: 'unspecified', session: true, expirationDate: null },
      { name: 'b', value: 'x=y', domain: 'app.example.com', hostOnly: true, path: '/', secure: true, httpOnly: false, sameSite: 'unspecified', session: true, expirationDate: null },
    ]);
    expect(plan.skipped).toEqual([{ name: 'flag', reason: 'has no “=”, so it is not a name=value pair' }]);
  });

  it('is secure only on an https site', () => {
    const plan = planImport('a=1', { url: 'http://localhost:3000/', nowSeconds: NOW });
    expect(plan.cookies[0]).toMatchObject({ domain: 'localhost', secure: false });
  });

  it('reads Set-Cookie attributes', () => {
    const c = parseSetCookie('Set-Cookie: sid=abc; Domain=example.com; Path=/app; Secure; HttpOnly; SameSite=Strict; Max-Age=3600', ctx);
    expect(c).toEqual({ name: 'sid', value: 'abc', domain: '.example.com', hostOnly: false, path: '/app', secure: true, httpOnly: true, sameSite: 'strict', session: false, expirationDate: NOW + 3600 });
  });

  it('lets Max-Age win over Expires, and reads Expires alone', () => {
    const both = parseSetCookie('a=1; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Max-Age=60', ctx);
    expect(both).toMatchObject({ expirationDate: NOW + 60 });
    const expires = parseSetCookie('a=1; Expires=Wed, 21 Oct 2037 07:28:00 GMT', ctx);
    expect(expires).toMatchObject({ session: false, expirationDate: Date.UTC(2037, 9, 21, 7, 28) / 1000 });
  });

  it('skips Partitioned and already-expired Set-Cookie lines with reasons', () => {
    const plan = planImport('Set-Cookie: p=1; Secure; Partitioned\nSet-Cookie: gone=1; Max-Age=0\nSet-Cookie: keep=1', ctx);
    expect(plan.format).toBe('set-cookie');
    expect(plan.cookies.map((c) => c.name)).toEqual(['keep']);
    expect(plan.skipped.map((s) => s.name)).toEqual(['p', 'gone']);
    expect(plan.skipped[0]!.reason).toMatch(/Partitioned/);
  });
});

describe('planImport — curl', () => {
  it('reads -b and uses the URL host', () => {
    const plan = planImport("curl -b 'sid=abc; theme=dark' 'https://api.example.org/v1/me'", ctx);
    expect(plan.format).toBe('curl');
    expect(plan.cookies.map((c) => [c.name, c.value, c.domain])).toEqual([['sid', 'abc', 'api.example.org'], ['theme', 'dark', 'api.example.org']]);
  });

  it('reads a Cookie header across continuation lines', () => {
    const plan = planImport('curl https://example.com/ \\\n  -H "Accept: */*" \\\n  -H "Cookie: a=1; b=2"', ctx);
    expect(plan.cookies.map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('explains a cookie file argument', () => {
    const plan = planImport('curl -b cookies.txt https://example.com', ctx);
    expect(plan.error).toMatch(/cookies\.txt/);
  });
});

describe('compareWithExisting', () => {
  it('counts new and replaced cookies by identity', () => {
    const existing: CookieLike[] = [{ name: 'a', value: 'old', domain: 'app.example.com', hostOnly: true, path: '/', secure: true, httpOnly: false, storeId: '0' }];
    const planned: CookieLike[] = [
      { name: 'a', value: 'new', domain: 'app.example.com', hostOnly: true, path: '/', secure: true, httpOnly: false },
      { name: 'b', value: '1', domain: 'app.example.com', hostOnly: true, path: '/', secure: true, httpOnly: false },
    ];
    expect(compareWithExisting(planned, existing)).toEqual({ create: 1, replace: 1 });
  });
});

describe('normalizeSameSite', () => {
  it('maps every spelling', () => {
    expect(['None', 'no_restriction', 'LAX', 'strict', 'unspecified', null, 7].map(normalizeSameSite))
      .toEqual(['no_restriction', 'no_restriction', 'lax', 'strict', 'unspecified', 'unspecified', 'unspecified']);
  });
});

// --- Round trip: everything we export can be imported back ---

const fixtures: CookieLike[] = [
  { name: 'sid', value: 'abc123', domain: 'app.example.com', hostOnly: true, path: '/', secure: true, httpOnly: true, sameSite: 'lax', session: false, expirationDate: 1900000000 },
  { name: 'pref', value: 'theme=dark', domain: '.example.com', hostOnly: false, path: '/', secure: false, httpOnly: false, sameSite: 'unspecified', session: true, expirationDate: null },
  { name: 'api', value: "it's-quoted", domain: 'app.example.com', hostOnly: true, path: '/api', secure: true, httpOnly: false, sameSite: 'strict', session: false, expirationDate: 1900000500 },
  { name: 'chips', value: 'p', domain: 'app.example.com', hostOnly: true, path: '/', secure: true, httpOnly: false, sameSite: 'no_restriction', session: true, expirationDate: null, partitionKey: { topLevelSite: 'https://example.com', hasCrossSiteAncestor: false } },
];

const pick = (c: CookieLike, keys: Array<keyof CookieLike>) => Object.fromEntries(keys.map((k) => [k, c[k] ?? null]));

describe('export → import round trip', () => {
  it('JSON keeps every attribute except the store', () => {
    const exported = JSON.stringify(fixtures.map((c) => ({ ...c, storeId: '0' })), null, 2);
    const plan = planImport(exported, ctx);
    expect(plan.skipped).toEqual([]);
    const keys: Array<keyof CookieLike> = ['name', 'value', 'domain', 'hostOnly', 'path', 'secure', 'httpOnly', 'sameSite', 'session', 'expirationDate', 'partitionKey'];
    expect(plan.cookies.map((c) => pick(c, keys))).toEqual(fixtures.map((c) => pick(c, keys)));
  });

  it('Netscape keeps name, value, domain, host-only, path, Secure, HttpOnly and expiry (it has no SameSite or partition)', () => {
    const plan = planImport(toNetscape(fixtures), ctx);
    expect(plan.skipped).toEqual([]);
    const keys: Array<keyof CookieLike> = ['name', 'value', 'domain', 'hostOnly', 'path', 'secure', 'httpOnly', 'session', 'expirationDate'];
    expect(plan.cookies.map((c) => pick(c, keys))).toEqual(fixtures.map((c) => pick(c, keys)));
  });

  it('Cookie header keeps names and values', () => {
    const plan = planImport(toHeaderString(fixtures), ctx);
    expect(plan.cookies.map((c) => [c.name, c.value])).toEqual(fixtures.map((c) => [c.name, c.value]));
  });

  it('curl keeps names and values, including a single quote', () => {
    const plan = planImport(toCurl(fixtures, 'https://app.example.com/'), ctx);
    expect(plan.format).toBe('curl');
    expect(plan.cookies.map((c) => [c.name, c.value])).toEqual(fixtures.map((c) => [c.name, c.value]));
  });
});
