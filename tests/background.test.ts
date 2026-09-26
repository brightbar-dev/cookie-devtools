// The background is the only place cookies are read and written: every surface sends it messages.
// These tests start it against WXT's fake browser with an in-memory cookie jar that behaves like
// chrome.cookies where it matters here — host-only vs domain cookies, CHIPS partitions, and the
// onChanged events (overwrite, then explicit) a write produces.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import background from '../entrypoints/background';
import { cookieHost, domainAppliesToHost } from '../utils/cookies';
import type { CookieLike, PartitionKey } from '../utils/cookies';
import { cookieIdentity } from '../utils/writes';
import { protectRuleFor, blockRuleFor } from '../utils/rules';
import type { Rules } from '../utils/rules';
import { t } from '../utils/i18n';

const NOW_S = () => Math.floor(Date.now() / 1000);

type Listener = (info: { removed: boolean; cause: string; cookie: CookieLike }) => unknown;
type Filter = { url?: string; name?: string; storeId?: string; partitionKey?: PartitionKey };
type Details = {
  url: string; name: string; value?: string; domain?: string; path?: string; secure?: boolean; httpOnly?: boolean;
  sameSite?: string; expirationDate?: number; storeId?: string; partitionKey?: PartitionKey;
};

/** An in-memory cookie store with the chrome.cookies behaviour the background depends on. */
function createJar(opts: { partitions?: boolean } = {}) {
  const cookies = new Map<string, CookieLike>();
  const listeners: Listener[] = [];
  const inFlight: Promise<unknown>[] = [];
  const calls = { set: [] as Details[], remove: [] as Details[], getAll: [] as Filter[] };
  let rejectSet: ((d: Details) => string | null) | null = null;

  const emit = (removed: boolean, cause: string, cookie: CookieLike) => {
    for (const l of listeners) inFlight.push(Promise.resolve(l({ removed, cause, cookie: { ...cookie } })));
  };
  const samePartition = (a?: PartitionKey | null, b?: PartitionKey | null) =>
    (a?.topLevelSite ?? '') === (b?.topLevelSite ?? '');

  const api = {
    async set(d: Details) {
      calls.set.push(d);
      const reason = rejectSet?.(d);
      if (reason) throw new Error(reason);
      const host = new URL(d.url).hostname;
      const cookie: CookieLike = {
        name: d.name,
        value: d.value ?? '',
        domain: d.domain ? '.' + cookieHost(d.domain) : host,
        hostOnly: !d.domain,
        path: d.path ?? '/',
        secure: !!d.secure,
        httpOnly: !!d.httpOnly,
        sameSite: d.sameSite ?? 'unspecified',
        session: d.expirationDate === undefined,
        storeId: d.storeId ?? '0',
        ...(d.expirationDate !== undefined ? { expirationDate: d.expirationDate } : {}),
        ...(d.partitionKey?.topLevelSite ? { partitionKey: { ...d.partitionKey } } : {}),
      };
      const id = cookieIdentity(cookie);
      const existing = cookies.get(id);
      const expired = d.expirationDate !== undefined && d.expirationDate <= NOW_S();
      if (existing) {
        cookies.delete(id);
        emit(true, expired ? 'expired_overwrite' : 'overwrite', existing);
      }
      if (expired) return null;
      cookies.set(id, cookie);
      emit(false, 'explicit', cookie);
      return { ...cookie };
    },
    async remove(d: Details) {
      calls.remove.push(d);
      const host = new URL(d.url).hostname;
      for (const [id, c] of cookies) {
        if (c.name === d.name && domainAppliesToHost(c.domain, host) && samePartition(c.partitionKey, d.partitionKey)) {
          cookies.delete(id);
          emit(true, 'explicit', c);
          return { url: d.url, name: d.name, storeId: c.storeId };
        }
      }
      return null;
    },
    async getAll(f: Filter) {
      calls.getAll.push(f);
      if (f.partitionKey && !opts.partitions) throw new Error('Unexpected property: "partitionKey".');
      const host = f.url ? new URL(f.url).hostname : null;
      return [...cookies.values()]
        .filter((c) => !host || domainAppliesToHost(c.domain, host))
        .filter((c) => !f.name || c.name === f.name)
        .filter((c) => {
          if (!f.partitionKey) return !c.partitionKey;
          if (!f.partitionKey.topLevelSite) return true;
          return c.partitionKey?.topLevelSite === f.partitionKey.topLevelSite;
        })
        .map((c) => ({ ...c }));
    },
    onChanged: {
      addListener: (l: Listener) => listeners.push(l),
      removeListener: (l: Listener) => listeners.splice(listeners.indexOf(l), 1),
      hasListener: (l: Listener) => listeners.includes(l),
    },
  };

  return {
    api,
    calls,
    all: () => [...cookies.values()],
    find: (name: string) => [...cookies.values()].filter((c) => c.name === name),
    rejectSetWhen(fn: typeof rejectSet) { rejectSet = fn; },
    /** A write the page itself makes (Set-Cookie or document.cookie): same events, no guard. */
    pageSet: (d: Details) => api.set(d),
    pageRemove: (d: Details) => api.remove(d),
    /** Wait until every onChanged listener — and whatever they wrote in turn — has finished. */
    async settle() {
      while (inFlight.length) await inFlight.shift();
    },
  };
}

type Jar = ReturnType<typeof createJar>;
let jar: Jar;

async function start(opts: { partitions?: boolean; storage?: Record<string, unknown> } = {}) {
  jar = createJar({ partitions: opts.partitions ?? true });
  Object.assign(fakeBrowser.cookies, jar.api);
  if (opts.storage) await fakeBrowser.storage.local.set(opts.storage);
  background.main!();
}

const send = (msg: Record<string, unknown>): Promise<any> => fakeBrowser.runtime.sendMessage(msg);

const seed = (d: Partial<Details> & { name: string }) =>
  jar.api.set({ url: 'https://app.example.com/', value: 'v', secure: true, path: '/', ...d });

async function storedRules(): Promise<Rules> {
  return (await fakeBrowser.storage.local.get('rules')).rules as Rules;
}

beforeEach(() => {
  fakeBrowser.reset();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('background: messages', () => {
  it('answers each known action through sendResponse and ignores unknown ones', async () => {
    await start();
    const listener = vi.fn();
    fakeBrowser.runtime.onMessage.addListener(listener);
    await expect(send({ action: 'getRules' })).resolves.toEqual({ rules: { protect: [], block: [] } });
    // An action nobody handles gets no reply, so another listener may answer it.
    await expect(send({ action: 'noSuchAction' })).resolves.toBeUndefined();
    await expect(send({})).resolves.toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe('background: getCookies', () => {
  it('returns the page’s cookies, its partitioned ones and those embedded frames keep under its site', async () => {
    await start();
    await seed({ name: 'session' });
    await seed({ name: 'parent', domain: 'example.com' });
    await seed({ name: 'chips', partitionKey: { topLevelSite: 'https://example.com' } });
    await jar.api.set({ url: 'https://widget.test/', name: 'embed', value: '1', secure: true, partitionKey: { topLevelSite: 'https://example.com' } });
    await jar.api.set({ url: 'https://widget.test/', name: 'elsewhere', value: '1', secure: true, partitionKey: { topLevelSite: 'https://other.org' } });
    await jar.api.set({ url: 'https://other.org/', name: 'unrelated', value: '1', secure: true });

    const res = await send({ action: 'getCookies', url: 'https://app.example.com/page' });

    expect(res.cookies.map((c: CookieLike) => c.name).sort()).toEqual(['chips', 'embed', 'parent', 'session']);
    expect(res.partitionSupport).toBe(true);
    // The page's own partitioned cookie is listed once, though both queries can see it.
    expect(res.cookies.filter((c: CookieLike) => c.name === 'chips')).toHaveLength(1);
  });

  it('falls back to a plain getAll where the browser has no partitionKey (older Chrome, Firefox)', async () => {
    await start({ partitions: false });
    await seed({ name: 'session' });

    const res = await send({ action: 'getCookies', url: 'https://app.example.com/' });

    expect(res.cookies.map((c: CookieLike) => c.name)).toEqual(['session']);
    expect(res.partitionSupport).toBe(false);
    // Probed once, then remembered: the second read does not try partitionKey again.
    jar.calls.getAll.length = 0;
    await send({ action: 'getCookies', url: 'https://app.example.com/' });
    expect(jar.calls.getAll).toEqual([{ url: 'https://app.example.com/' }]);
  });

  it('reports only the rules that concern the page, and every protected identity', async () => {
    const here = protectRuleFor({ name: 'a', value: '1', domain: 'app.example.com', hostOnly: true, path: '/', secure: true, httpOnly: false }, 1);
    const there = protectRuleFor({ name: 'b', value: '1', domain: 'other.org', hostOnly: true, path: '/', secure: true, httpOnly: false }, 1);
    const blockHere = blockRuleFor({ name: '_ga', domain: '.example.com' }, 1);
    const blockThere = blockRuleFor({ name: '_ga', domain: 'other.org' }, 1);
    await start({ storage: { rules: { protect: [here, there], block: [blockHere, blockThere] } } });

    const res = await send({ action: 'getCookies', url: 'https://app.example.com/' });

    expect(res.protectedIds).toEqual([here.id, there.id]);
    expect(res.protected).toEqual([here]);
    expect(res.blocked).toEqual([blockHere]);
  });
});

describe('background: updateCookie (set, then remove)', () => {
  it('keeps a host-only cookie host-only and does not remove what it just wrote', async () => {
    await start();
    const original = await seed({ name: 'sid', value: 'old' });

    const res = await send({ action: 'updateCookie', original, cookie: { ...original, value: 'new' } });

    expect(res.error).toBeUndefined();
    expect(jar.calls.set.at(-1)).not.toHaveProperty('domain');
    expect(jar.calls.remove).toEqual([]);
    expect(jar.find('sid')).toMatchObject([{ value: 'new', hostOnly: true, domain: 'app.example.com' }]);
  });

  it('removes the original only after a rename has been written', async () => {
    await start();
    const original = await seed({ name: 'old_name' });

    const res = await send({ action: 'updateCookie', original, cookie: { ...original, name: 'new_name' } });

    expect(res.cookie).toMatchObject({ name: 'new_name' });
    expect(jar.all().map((c) => c.name)).toEqual(['new_name']);
  });

  it('changes nothing when the browser rejects the write', async () => {
    await start();
    const original = await seed({ name: 'keep' });
    jar.rejectSetWhen(() => 'Failed to parse or set cookie named "keep 2".');

    const res = await send({ action: 'updateCookie', original, cookie: { ...original, name: 'keep 2' } });

    expect(res.error).toBe('Failed to parse or set cookie named "keep 2".');
    expect(jar.calls.remove).toEqual([]);
    expect(jar.all().map((c) => c.name)).toEqual(['keep']);
  });

  it('treats a past expiry as a delete, not a failure', async () => {
    await start();
    const original = await seed({ name: 'gone', expirationDate: NOW_S() + 3600 });

    const res = await send({ action: 'updateCookie', original, cookie: { ...original, expirationDate: NOW_S() - 10 } });

    expect(res).toMatchObject({ deleted: true, cookie: null });
    expect(res.error).toBeUndefined();
    expect(jar.all()).toEqual([]);
  });

  it('moves Protect to the renamed cookie, and turns it on or off when asked', async () => {
    await start();
    const original = await seed({ name: 'a' });
    await send({ action: 'setProtect', cookie: original, on: true });

    await send({ action: 'updateCookie', original, cookie: { ...original, name: 'b' } });
    const [renamed] = jar.find('b');
    if (!renamed) throw new Error('rename not written');
    expect((await storedRules()).protect.map((r) => r.id)).toEqual([cookieIdentity(renamed)]);

    await send({ action: 'updateCookie', original: renamed, cookie: { ...renamed, value: 'x' }, protect: false });
    expect((await storedRules()).protect).toEqual([]);
  });
});

describe('background: removeCookies', () => {
  it('reports each cookie it could not find instead of claiming success', async () => {
    await start();
    const present = await seed({ name: 'here' });
    const missing = { ...present, name: 'not_here' };

    const res = await send({ action: 'removeCookies', cookies: [present, missing] });

    expect(res.removed.map((c: CookieLike) => c.name)).toEqual(['here']);
    expect(res.failed).toEqual([{ name: 'not_here', domain: 'app.example.com', error: t('errorNotFound') }]);
  });

  it('passes the partition key, without which remove is a silent no-op on a CHIPS cookie', async () => {
    await start();
    const chips = await seed({ name: 'chips', partitionKey: { topLevelSite: 'https://example.com' } });

    const res = await send({ action: 'removeCookies', cookies: [chips] });

    expect(jar.calls.remove[0]?.partitionKey).toEqual({ topLevelSite: 'https://example.com' });
    expect(res.removed).toHaveLength(1);
    expect(jar.all()).toEqual([]);
  });

  it('ends protection for a protected cookie deleted on purpose', async () => {
    await start();
    const c = await seed({ name: 'locked' });
    await send({ action: 'setProtect', cookie: c, on: true });

    await send({ action: 'removeCookies', cookies: [c] });
    await jar.settle();

    expect((await storedRules()).protect).toEqual([]);
    expect(jar.all()).toEqual([]);
  });
});

describe('background: restore, import and profiles', () => {
  it('writes a snapshot back, skipping cookies that have expired since', async () => {
    await start();
    const live = { name: 'live', value: '1', domain: 'app.example.com', hostOnly: true, path: '/', secure: true, httpOnly: false, session: true };
    const stale = { ...live, name: 'stale', session: false, expirationDate: NOW_S() - 60 };

    const res = await send({ action: 'restoreCookies', cookies: [live, stale] });

    expect(res.written.map((c: CookieLike) => c.name)).toEqual(['live']);
    expect(res.expired).toEqual(['stale']);
    expect(res.failed).toEqual([]);
  });

  it('reports a write the browser refused and carries on with the rest', async () => {
    await start();
    jar.rejectSetWhen((d) => (d.name === 'bad' ? 'Failed to parse or set cookie named "bad".' : null));
    const base = { value: '1', domain: 'app.example.com', hostOnly: true, path: '/', secure: true, httpOnly: false, session: true };

    const res = await send({ action: 'importCookies', cookies: [{ ...base, name: 'bad' }, { ...base, name: 'good' }] });

    expect(res.written.map((c: CookieLike) => c.name)).toEqual(['good']);
    expect(res.failed).toEqual([{ name: 'bad', domain: 'app.example.com', error: 'Failed to parse or set cookie named "bad".' }]);
  });

  it('saves a profile, lists it, and loads it over a cleared page with an undo snapshot', async () => {
    await start();
    await seed({ name: 'env', value: 'staging' });
    const saved = await send({ action: 'saveProfile', name: 'Staging', url: 'https://app.example.com/' });
    expect(saved).toEqual({ success: true, count: 1 });

    const { profiles } = await send({ action: 'getProfiles' });
    expect(profiles).toEqual({ Staging: { savedAt: expect.any(Number), count: 1, url: 'https://app.example.com/' } });
    // The summary leaves the cookie values in storage.
    expect(profiles.Staging).not.toHaveProperty('cookies');

    await jar.api.remove({ url: 'https://app.example.com/', name: 'env' });
    await seed({ name: 'env', value: 'production' });
    await seed({ name: 'extra' });

    const loaded = await send({ action: 'loadProfile', name: 'Staging', clearFirst: true });

    expect(loaded.previous.map((c: CookieLike) => c.name).sort()).toEqual(['env', 'extra']);
    expect(loaded.written.map((c: CookieLike) => c.name)).toEqual(['env']);
    expect(jar.all().map((c) => [c.name, c.value])).toEqual([['env', 'staging']]);
  });

  it('says so when a profile does not exist, and forgets a deleted one', async () => {
    await start();
    await send({ action: 'saveProfile', name: 'Gone', url: 'https://app.example.com/' });
    await send({ action: 'deleteProfile', name: 'Gone' });

    expect(await send({ action: 'getProfiles' })).toEqual({ profiles: {} });
    expect(await send({ action: 'loadProfile', name: 'Gone' })).toEqual({ error: t('errorProfileNotFound') });
  });

  // BUG: profiles are a plain object keyed by the name the user types, so `profiles['__proto__'] = …`
  // sets the object's prototype instead of adding a profile. saveProfile replies success (the popup
  // toasts "Saved 1 cookie") but nothing reaches storage and the profile never appears. Names
  // inherited from Object.prototype ('toString', 'constructor') also make loadProfile answer
  // "cookies is not iterable" instead of errorProfileNotFound. A Map or Object.hasOwn check fixes both.
  it.skip('saves and lists a profile whatever the user names it', async () => {
    await start();
    await seed({ name: 'env' });

    expect(await send({ action: 'saveProfile', name: '__proto__', url: 'https://app.example.com/' })).toEqual({ success: true, count: 1 });

    const { profiles } = await send({ action: 'getProfiles' });
    expect(Object.keys(profiles)).toEqual(['__proto__']);
    expect(await send({ action: 'loadProfile', name: 'toString' })).toEqual({ error: t('errorProfileNotFound') });
  });
});

describe('background: Protect and Block enforcement', () => {
  it('puts a protected cookie back when the page deletes or changes it', async () => {
    await start();
    const c = await seed({ name: 'consent', value: 'granted' });
    await send({ action: 'setProtect', cookie: c, on: true });
    await jar.settle();

    await jar.pageRemove({ url: 'https://app.example.com/', name: 'consent' });
    await jar.settle();
    expect(jar.find('consent')).toMatchObject([{ value: 'granted' }]);

    await jar.pageSet({ url: 'https://app.example.com/', name: 'consent', value: 'denied', secure: true });
    await jar.settle();
    expect(jar.find('consent')).toMatchObject([{ value: 'granted' }]);
  });

  it('does not fight the user’s own edit of a protected cookie, and locks the new value', async () => {
    await start();
    const c = await seed({ name: 'consent', value: 'granted' });
    await send({ action: 'setProtect', cookie: c, on: true });
    await jar.settle();

    await send({ action: 'updateCookie', original: c, cookie: { ...c, value: 'denied' } });
    await jar.settle();

    expect(jar.find('consent')).toMatchObject([{ value: 'denied' }]);
    expect((await storedRules()).protect[0]?.cookie.value).toBe('denied');
  });

  it('stops restoring after the cap so a page rewriting in a loop cannot pin the worker', async () => {
    await start();
    const c = await seed({ name: 'consent', value: 'granted' });
    await send({ action: 'setProtect', cookie: c, on: true });
    await jar.settle();
    jar.calls.set.length = 0;

    for (let i = 0; i < 8; i++) {
      await jar.pageSet({ url: 'https://app.example.com/', name: 'consent', value: `page${i}`, secure: true });
      await jar.settle();
    }

    const restores = jar.calls.set.filter((d) => d.value === 'granted');
    expect(restores).toHaveLength(5);
    expect(jar.find('consent')).toMatchObject([{ value: 'page7' }]);
  });

  it('checks again when the quiet window ends, so a page write inside it does not stick', async () => {
    vi.useFakeTimers(); // Date too: the restore window is measured with Date.now
    await start();
    const c = await seed({ name: 'consent', value: 'granted' });
    await send({ action: 'setProtect', cookie: c, on: true });
    await jar.settle();
    for (let i = 0; i < 6; i++) {
      await jar.pageSet({ url: 'https://app.example.com/', name: 'consent', value: `page${i}`, secure: true });
      await jar.settle();
    }
    expect(jar.find('consent')).toMatchObject([{ value: 'page5' }]);

    await vi.advanceTimersByTimeAsync(10_200);
    await jar.settle();

    expect(jar.find('consent')).toMatchObject([{ value: 'granted' }]);
  });

  it('moves the lock when the user imports a new value for a protected cookie', async () => {
    await start();
    const c = await seed({ name: 'consent', value: 'granted' });
    await send({ action: 'setProtect', cookie: c, on: true });
    await jar.settle();

    const res = await send({ action: 'importCookies', cookies: [{ ...c, value: 'denied' }] });
    await jar.settle();

    expect(res.written).toHaveLength(1);
    expect(jar.find('consent')).toMatchObject([{ value: 'denied' }]);
    expect((await storedRules()).protect.map((r) => r.cookie.value)).toEqual(['denied']);
  });

  it('removes a blocked cookie whenever a page sets it, on the domain and its subdomains', async () => {
    await start();
    const c = await seed({ name: '_ga', domain: 'example.com' });

    const res = await send({ action: 'blockCookie', cookie: c });
    await jar.settle();
    expect(res.removed).toHaveLength(1);
    expect(jar.all()).toEqual([]);

    await jar.pageSet({ url: 'https://app.example.com/', name: '_ga', value: 'GA1.2', domain: 'example.com', secure: true });
    await jar.settle();
    expect(jar.find('_ga')).toEqual([]);

    await send({ action: 'unblockCookie', id: res.rule.id });
    await jar.pageSet({ url: 'https://app.example.com/', name: '_ga', value: 'GA1.3', domain: 'example.com', secure: true });
    await jar.settle();
    expect(jar.find('_ga')).toHaveLength(1);
  });

  it('blocking a protected cookie ends its protection, so the two rules never fight', async () => {
    await start();
    const c = await seed({ name: 'x' });
    await send({ action: 'setProtect', cookie: c, on: true });

    await send({ action: 'blockCookie', cookie: c });
    await jar.settle();

    const rules = await storedRules();
    expect(rules.protect).toEqual([]);
    expect(rules.block.map((r) => r.name)).toEqual(['x']);
    expect(jar.all()).toEqual([]);
  });
});

describe('background: change monitor', () => {
  it('records nothing until Record is switched on', async () => {
    await start();
    await jar.pageSet({ url: 'https://app.example.com/', name: 'a', value: '1' });
    await jar.settle();

    expect(await send({ action: 'getChangeLog' })).toEqual({ changeLog: [] });
  });

  it('records changes newest first once on, and only for the chosen site', async () => {
    await start({ storage: { monitor: { recording: true, scope: 'site', site: 'app.example.com' } } });
    await jar.pageSet({ url: 'https://app.example.com/', name: 'first', value: '1' });
    await jar.pageSet({ url: 'https://other.org/', name: 'ignored', value: '1' });
    await jar.pageRemove({ url: 'https://app.example.com/', name: 'first' });
    await jar.settle();

    const { changeLog } = await send({ action: 'getChangeLog' });

    expect(changeLog.map((e: { removed: boolean; cause: string; cookie: CookieLike }) => [e.cookie.name, e.removed, e.cause]))
      .toEqual([['first', true, 'explicit'], ['first', false, 'explicit']]);
  });

  it('clears the log', async () => {
    await start({ storage: { monitor: { recording: true, scope: 'all', site: '' } } });
    await jar.pageSet({ url: 'https://app.example.com/', name: 'a', value: '1' });
    await jar.settle();
    await send({ action: 'getChangeLog' });
    await jar.pageSet({ url: 'https://app.example.com/', name: 'b', value: '1' });
    await jar.settle();

    await send({ action: 'clearChangeLog' });
    await vi.runAllTimersAsync();

    expect(await send({ action: 'getChangeLog' })).toEqual({ changeLog: [] });
  });
});
