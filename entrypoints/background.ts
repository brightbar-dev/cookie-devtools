import { domainAppliesToHost } from '@/utils/cookies';
import type { CookieLike } from '@/utils/cookies';
import type { ChangeEntry, Failure, WriteReport } from '@/utils/messages';
import {
  toSetDetails, toRemoveDetails, shouldRemoveOriginal, planRestore, dedupeCookies,
  partitionSiteCandidates, isExpired,
} from '@/utils/writes';
import {
  ChangeLogBuffer, DEFAULT_MONITOR, DEFAULT_MAX_LOG, normalizeMonitorSettings, clampMaxLog, shouldRecord,
} from '@/utils/monitor';
import type { MonitorSettings } from '@/utils/monitor';

type Message = Record<string, unknown>;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default defineBackground(() => {
  // Monitor settings, cached from storage and kept current as the popup changes them.
  let monitor: MonitorSettings = DEFAULT_MONITOR;
  let maxLog = DEFAULT_MAX_LOG;
  let settingsChanged = false;
  const settingsReady = browser.storage.local
    .get({ monitor: DEFAULT_MONITOR, maxLog: DEFAULT_MAX_LOG })
    .then((data) => {
      if (settingsChanged) return;
      monitor = normalizeMonitorSettings(data.monitor);
      maxLog = clampMaxLog(data.maxLog);
    });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.monitor) {
      settingsChanged = true;
      monitor = normalizeMonitorSettings(changes.monitor.newValue);
    }
    if (changes.maxLog) maxLog = clampMaxLog(changes.maxLog.newValue);
  });

  const changeLog = new ChangeLogBuffer<ChangeEntry>({
    read: async () => ((await browser.storage.local.get({ changeLog: [] })).changeLog as ChangeEntry[]) || [],
    write: (log) => browser.storage.local.set({ changeLog: log }),
    maxEntries: () => maxLog,
  });

  // Cookie change monitor — records only while the user has Record switched on.
  browser.cookies.onChanged.addListener(async (changeInfo) => {
    await settingsReady;
    const c = changeInfo.cookie;
    if (!shouldRecord(monitor, c.domain)) return;
    changeLog.push({
      timestamp: Date.now(),
      removed: changeInfo.removed,
      cause: changeInfo.cause,
      cookie: {
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
        expirationDate: c.expirationDate,
        session: c.session,
        storeId: c.storeId,
        hostOnly: c.hostOnly,
        partitionKey: c.partitionKey,
      },
    });
  });

  const handlers: Record<string, (msg: Message) => Promise<unknown>> = {
    getCookies: handleGetCookies,
    updateCookie: handleUpdateCookie,
    removeCookies: handleRemoveCookies,
    restoreCookies: (msg) => writeCookies((msg.cookies as CookieLike[]) || []),
    importCookies: (msg) => writeCookies((msg.cookies as CookieLike[]) || []),
    getChangeLog: handleGetChangeLog,
    clearChangeLog: handleClearChangeLog,
    saveProfile: handleSaveProfile,
    loadProfile: handleLoadProfile,
    deleteProfile: handleDeleteProfile,
    getProfiles: handleGetProfiles,
  };

  // sendResponse + `return true` rather than a returned promise: it works in every Chrome and Firefox version.
  browser.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
    const handler = handlers[msg?.action as string];
    if (!handler) return false;
    handler(msg).then(sendResponse, (err) => sendResponse({ error: errorMessage(err) }));
    return true;
  });

  // Reading cookies

  let partitionSupport: boolean | null = null;

  async function getAllForUrl(url: string): Promise<CookieLike[]> {
    if (partitionSupport !== false) {
      try {
        // partitionKey: {} includes partitioned (CHIPS) cookies, which getAll otherwise omits.
        const cookies = await browser.cookies.getAll({ url, partitionKey: {} });
        partitionSupport = true;
        return cookies;
      } catch {
        partitionSupport = false;
      }
    }
    return browser.cookies.getAll({ url });
  }

  /**
   * The cookies for a page: everything sent to its URL, partitioned or not, plus partitioned
   * cookies that embedded cross-site frames keep in this site's partition.
   */
  async function getCookiesForUrl(url: string): Promise<CookieLike[]> {
    const own = await getAllForUrl(url);
    if (!partitionSupport) return own;
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      return own;
    }
    const embedded: CookieLike[] = [];
    for (const topLevelSite of partitionSiteCandidates(url)) {
      try {
        const found = await browser.cookies.getAll({ partitionKey: { topLevelSite } });
        embedded.push(...found.filter((c) => !domainAppliesToHost(c.domain, host)));
      } catch {
        // not a site the browser recognises
      }
    }
    return dedupeCookies([...own, ...embedded]);
  }

  async function handleGetCookies(msg: Message) {
    const url = msg.url as string | undefined;
    const cookies = url ? await getCookiesForUrl(url) : await browser.cookies.getAll({});
    return { cookies, partitionSupport: !!partitionSupport };
  }

  // Writing cookies

  /**
   * Edit = set, then remove. The new cookie is written first; the original is removed only when
   * that write succeeded and landed in a different jar entry. A rejected write changes nothing.
   */
  async function handleUpdateCookie(msg: Message) {
    const original = (msg.original as CookieLike | null) || null;
    const cookie = msg.cookie as CookieLike;
    let written: CookieLike | null;
    try {
      written = (await browser.cookies.set(toSetDetails(cookie) as Browser.cookies.SetDetails)) ?? null;
    } catch (err) {
      return { error: errorMessage(err) };
    }
    // A past expiry makes set() delete the cookie and return nothing.
    const deleted = isExpired(cookie, Date.now() / 1000);
    if (!written && !deleted) return { error: 'The browser did not store the cookie.' };

    if (original && shouldRemoveOriginal(original, cookie, written)) {
      try {
        await browser.cookies.remove(toRemoveDetails(original));
      } catch (err) {
        return {
          cookie: written,
          deleted,
          warning: `Saved, but the previous “${original.name}” could not be removed: ${errorMessage(err)}`,
        };
      }
    }
    return { cookie: written, deleted };
  }

  async function handleRemoveCookies(msg: Message) {
    const cookies = (msg.cookies as CookieLike[]) || [];
    const removed: CookieLike[] = [];
    const failed: Failure[] = [];
    for (const cookie of cookies) {
      try {
        const result = await browser.cookies.remove(toRemoveDetails(cookie));
        if (result) removed.push(cookie);
        else failed.push({ name: cookie.name, domain: cookie.domain, error: 'not found' });
      } catch (err) {
        failed.push({ name: cookie.name, domain: cookie.domain, error: errorMessage(err) });
      }
    }
    return { removed, failed };
  }

  /** Write cookies exactly as given (a snapshot, a profile or an import), skipping any that have expired. */
  async function writeCookies(cookies: CookieLike[]): Promise<WriteReport> {
    const { toSet, expired } = planRestore(cookies, Date.now() / 1000);
    const written: CookieLike[] = [];
    const failed: Failure[] = [];
    for (const cookie of toSet) {
      try {
        const result = await browser.cookies.set(toSetDetails(cookie) as Browser.cookies.SetDetails);
        if (result) written.push(result);
        else failed.push({ name: cookie.name, domain: cookie.domain, error: 'not stored' });
      } catch (err) {
        failed.push({ name: cookie.name, domain: cookie.domain, error: errorMessage(err) });
      }
    }
    return { written, expired: expired.map((c) => c.name), failed };
  }

  // Change log

  async function handleGetChangeLog() {
    await changeLog.flush();
    const data = await browser.storage.local.get({ changeLog: [] });
    return { changeLog: data.changeLog };
  }

  async function handleClearChangeLog() {
    changeLog.discard();
    await changeLog.flush();
    await browser.storage.local.set({ changeLog: [] });
    return { success: true };
  }

  // Profiles

  async function handleSaveProfile(msg: Message) {
    const name = msg.name as string;
    const url = msg.url as string | undefined;
    const cookies = url ? await getCookiesForUrl(url) : await browser.cookies.getAll({});
    const data = await browser.storage.local.get({ profiles: {} });
    const profiles = data.profiles as Record<string, unknown>;
    profiles[name] = {
      cookies,
      url: url || null,
      savedAt: Date.now(),
      count: cookies.length,
    };
    await browser.storage.local.set({ profiles });
    return { success: true, count: cookies.length };
  }

  async function handleLoadProfile(msg: Message) {
    const name = msg.name as string;
    const clearFirst = msg.clearFirst as boolean;
    const data = await browser.storage.local.get({ profiles: {} });
    const profiles = data.profiles as Record<string, { cookies: CookieLike[]; url: string | null }>;
    const profile = profiles[name];

    if (!profile) return { error: 'Profile not found' };

    // What was there before, so the popup can undo the load.
    let previous: CookieLike[] = [];
    if (clearFirst && profile.url) {
      const existing = await getCookiesForUrl(profile.url);
      previous = (await handleRemoveCookies({ cookies: existing })).removed;
    }

    const report = await writeCookies(profile.cookies);
    return { ...report, previous };
  }

  async function handleDeleteProfile(msg: Message) {
    const data = await browser.storage.local.get({ profiles: {} });
    const profiles = data.profiles as Record<string, unknown>;
    delete profiles[msg.name as string];
    await browser.storage.local.set({ profiles });
    return { success: true };
  }

  async function handleGetProfiles() {
    const data = await browser.storage.local.get({ profiles: {} });
    const profiles = data.profiles as Record<string, { savedAt: number; count: number; url: string | null }>;
    const summary: Record<string, { savedAt: number; count: number; url: string | null }> = {};
    for (const [name, profile] of Object.entries(profiles)) {
      summary[name] = {
        savedAt: profile.savedAt,
        count: profile.count,
        url: profile.url,
      };
    }
    return { profiles: summary };
  }
});
