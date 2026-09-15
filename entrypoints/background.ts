import { domainAppliesToHost } from '@/utils/cookies';
import { t } from '@/utils/i18n';
import type { CookieLike } from '@/utils/cookies';
import type { ChangeEntry, Failure, WriteReport } from '@/utils/messages';
import {
  toSetDetails, toRemoveDetails, shouldRemoveOriginal, planRestore, dedupeCookies,
  partitionSiteCandidates, isExpired, cookieIdentity,
} from '@/utils/writes';
import {
  ChangeLogBuffer, DEFAULT_MONITOR, DEFAULT_MAX_LOG, normalizeMonitorSettings, clampMaxLog, shouldRecord,
  domainMatchesSite,
} from '@/utils/monitor';
import type { MonitorSettings } from '@/utils/monitor';
import {
  EMPTY_RULES, normalizeRules, decideRuleAction, matchesLockedState, protectRuleFor, blockRuleFor,
  withProtect, withoutProtect, withBlock, withoutBlock, blockRulesForHost, WriteGuard,
} from '@/utils/rules';
import type { Rules } from '@/utils/rules';

type Message = Record<string, unknown>;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default defineBackground(() => {
  // Settings and rules, cached from storage and kept current as pages change them.
  let monitor: MonitorSettings = DEFAULT_MONITOR;
  let maxLog = DEFAULT_MAX_LOG;
  let rules: Rules = EMPTY_RULES;
  const changedBeforeLoad = new Set<string>();
  const settingsReady = browser.storage.local
    .get({ monitor: DEFAULT_MONITOR, maxLog: DEFAULT_MAX_LOG, rules: EMPTY_RULES })
    .then((data) => {
      if (!changedBeforeLoad.has('monitor')) monitor = normalizeMonitorSettings(data.monitor);
      if (!changedBeforeLoad.has('rules')) rules = normalizeRules(data.rules);
      maxLog = clampMaxLog(data.maxLog);
    });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.monitor) {
      changedBeforeLoad.add('monitor');
      monitor = normalizeMonitorSettings(changes.monitor.newValue);
    }
    if (changes.rules) {
      changedBeforeLoad.add('rules');
      rules = normalizeRules(changes.rules.newValue);
    }
    if (changes.maxLog) maxLog = clampMaxLog(changes.maxLog.newValue);
  });

  async function saveRules(next: Rules) {
    rules = next;
    await browser.storage.local.set({ rules: next });
  }

  const changeLog = new ChangeLogBuffer<ChangeEntry>({
    read: async () => ((await browser.storage.local.get({ changeLog: [] })).changeLog as ChangeEntry[]) || [],
    write: (log) => browser.storage.local.set({ changeLog: log }),
    maxEntries: () => maxLog,
  });

  // The extension's own writes must not trigger Protect/Block, and Protect must not fight a page forever.
  const guard = new WriteGuard();

  browser.cookies.onChanged.addListener(async (changeInfo) => {
    await settingsReady;
    const c = changeInfo.cookie;
    // Change monitor — records only while the user has Record switched on.
    if (shouldRecord(monitor, c.domain)) {
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
    }
    await enforceRules({ removed: changeInfo.removed, cause: changeInfo.cause, cookie: c });
  });

  // A cookie whose restores hit the cap gets one more look when the window ends.
  const deferredChecks = new Set<string>();

  async function enforceRules(change: { removed: boolean; cause: string; cookie: CookieLike }) {
    if (rules.protect.length === 0 && rules.block.length === 0) return;
    const id = cookieIdentity(change.cookie);
    if (guard.isOwnWrite(id, change.removed, change.cookie.value)) return;
    const action = decideRuleAction(change, rules, Date.now() / 1000);
    if (action.type === 'restore') {
      if (!guard.allowRestore(id)) {
        if (!deferredChecks.has(action.rule.id)) {
          deferredChecks.add(action.rule.id);
          setTimeout(() => {
            deferredChecks.delete(action.rule.id);
            void verifyProtected(action.rule.id);
          }, guard.restoreWindowMs + 200);
        }
        return;
      }
      guard.expectSet(id, action.rule.cookie.value);
      try {
        await browser.cookies.set(toSetDetails(action.rule.cookie) as Browser.cookies.SetDetails);
      } catch {
        // the browser refused; nothing to undo
      }
    } else if (action.type === 'remove') {
      guard.expectRemove(id);
      try {
        await browser.cookies.remove(toRemoveDetails(action.cookie));
      } catch {
        // already gone
      }
    }
  }

  async function findExact(cookie: CookieLike): Promise<CookieLike | undefined> {
    const details = toRemoveDetails(cookie);
    const id = cookieIdentity(cookie);
    try {
      const found = await browser.cookies.getAll({
        url: details.url,
        name: details.name,
        ...(details.storeId ? { storeId: details.storeId } : {}),
        ...(details.partitionKey ? { partitionKey: details.partitionKey } : {}),
      });
      return found.find((c) => cookieIdentity(c) === id);
    } catch {
      return undefined;
    }
  }

  async function verifyProtected(ruleId: string) {
    const rule = rules.protect.find((r) => r.id === ruleId);
    if (!rule) return;
    const current = await findExact(rule.cookie);
    if (current && matchesLockedState(rule.cookie, current)) return;
    await enforceRules({ removed: !current, cause: 'explicit', cookie: current ?? rule.cookie });
  }

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
    getRules: async () => {
      await settingsReady;
      return { rules };
    },
    setProtect: handleSetProtect,
    blockCookie: handleBlockCookie,
    unblockCookie: handleUnblockCookie,
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
    await settingsReady;
    const url = msg.url as string | undefined;
    const cookies = url ? await getCookiesForUrl(url) : await browser.cookies.getAll({});
    let host = '';
    try {
      host = url ? new URL(url).hostname : '';
    } catch {
      host = '';
    }
    return {
      cookies,
      protectedIds: rules.protect.map((r) => r.id),
      protected: host ? rules.protect.filter((r) => domainMatchesSite(r.cookie.domain, host)) : rules.protect,
      blocked: host ? blockRulesForHost(rules, host) : rules.block,
      partitionSupport: !!partitionSupport,
    };
  }

  // Writing cookies

  /**
   * Edit = set, then remove. The new cookie is written first; the original is removed only when
   * that write succeeded and landed in a different jar entry. A rejected write changes nothing.
   * `protect` true/false turns Protect on or off for the saved cookie; left out, it stays as it was.
   */
  async function handleUpdateCookie(msg: Message) {
    await settingsReady;
    const original = (msg.original as CookieLike | null) || null;
    const cookie = msg.cookie as CookieLike;
    const protect = msg.protect as boolean | undefined;
    const id = cookieIdentity(cookie);
    if (isExpired(cookie, Date.now() / 1000)) guard.expectRemove(id);
    else guard.expectSet(id, cookie.value);
    if (original && cookieIdentity(original) !== id) guard.expectRemove(cookieIdentity(original));

    let written: CookieLike | null;
    try {
      written = (await browser.cookies.set(toSetDetails(cookie) as Browser.cookies.SetDetails)) ?? null;
    } catch (err) {
      return { error: errorMessage(err) };
    }
    // A past expiry makes set() delete the cookie and return nothing.
    const deleted = isExpired(cookie, Date.now() / 1000);
    if (!written && !deleted) return { error: t('errorCookieNotStored') };

    let warning: string | undefined;
    if (original && shouldRemoveOriginal(original, cookie, written)) {
      try {
        await browser.cookies.remove(toRemoveDetails(original));
      } catch (err) {
        warning = t('warningOriginalNotRemoved', original.name, errorMessage(err));
      }
    }

    // Protect follows what the user saved.
    const wasProtected = !!original && rules.protect.some((r) => r.id === cookieIdentity(original));
    const keepProtected = protect ?? wasProtected;
    let next = original ? withoutProtect(rules, cookieIdentity(original)) : rules;
    if (keepProtected && written) next = withProtect(next, protectRuleFor(written, Date.now()));
    if (next.protect.length !== rules.protect.length || keepProtected) await saveRules(next);

    return { cookie: written, deleted, warning, protected: keepProtected && !!written };
  }

  async function handleRemoveCookies(msg: Message) {
    await settingsReady;
    const cookies = (msg.cookies as CookieLike[]) || [];
    const removed: CookieLike[] = [];
    const failed: Failure[] = [];
    for (const cookie of cookies) {
      guard.expectRemove(cookieIdentity(cookie));
      try {
        const result = await browser.cookies.remove(toRemoveDetails(cookie));
        if (result) removed.push(cookie);
        else failed.push({ name: cookie.name, domain: cookie.domain, error: t('errorNotFound') });
      } catch (err) {
        failed.push({ name: cookie.name, domain: cookie.domain, error: errorMessage(err) });
      }
    }
    // Deleting a protected cookie on purpose ends its protection.
    const removedIds = new Set(removed.map((c) => cookieIdentity(c)));
    if (rules.protect.some((r) => removedIds.has(r.id))) {
      await saveRules({ ...rules, protect: rules.protect.filter((r) => !removedIds.has(r.id)) });
    }
    return { removed, failed };
  }

  /** Write cookies exactly as given (a snapshot, a profile or an import), skipping any that have expired. */
  async function writeCookies(cookies: CookieLike[]): Promise<WriteReport> {
    await settingsReady;
    const { toSet, expired } = planRestore(cookies, Date.now() / 1000);
    const written: CookieLike[] = [];
    const failed: Failure[] = [];
    let next = rules;
    for (const cookie of toSet) {
      const id = cookieIdentity(cookie);
      guard.expectSet(id, cookie.value);
      try {
        const result = await browser.cookies.set(toSetDetails(cookie) as Browser.cookies.SetDetails);
        if (result) {
          written.push(result);
          // A protected cookie the user writes on purpose is protected at its new state.
          if (next.protect.some((r) => r.id === id)) next = withProtect(next, protectRuleFor(result, Date.now()));
        } else {
          failed.push({ name: cookie.name, domain: cookie.domain, error: t('errorNotStored') });
        }
      } catch (err) {
        failed.push({ name: cookie.name, domain: cookie.domain, error: errorMessage(err) });
      }
    }
    if (next !== rules) await saveRules(next);
    return { written, expired: expired.map((c) => c.name), failed };
  }

  // Protect and Block

  async function handleSetProtect(msg: Message) {
    await settingsReady;
    const cookie = msg.cookie as CookieLike;
    const on = msg.on === true;
    await saveRules(on ? withProtect(rules, protectRuleFor(cookie, Date.now())) : withoutProtect(rules, cookieIdentity(cookie)));
    return { success: true };
  }

  async function handleBlockCookie(msg: Message) {
    await settingsReady;
    const cookie = msg.cookie as CookieLike;
    const rule = blockRuleFor(cookie, Date.now());
    await saveRules(withBlock(withoutProtect(rules, cookieIdentity(cookie)), rule));
    const { removed } = await handleRemoveCookies({ cookies: [cookie] });
    return { rule, removed };
  }

  async function handleUnblockCookie(msg: Message) {
    await settingsReady;
    await saveRules(withoutBlock(rules, msg.id as string));
    return { success: true };
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

    if (!profile) return { error: t('errorProfileNotFound') };

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
