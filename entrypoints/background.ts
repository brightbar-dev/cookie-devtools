import { toNetscape, toCurl, toHeaderString } from '@/utils/cookies';

const MAX_CHANGE_LOG = 500;

export default defineBackground(() => {
  // Cookie change monitor
  browser.cookies.onChanged.addListener((changeInfo) => {
    const entry = {
      timestamp: Date.now(),
      removed: changeInfo.removed,
      cookie: {
        name: changeInfo.cookie.name,
        value: changeInfo.cookie.value,
        domain: changeInfo.cookie.domain,
        path: changeInfo.cookie.path,
        secure: changeInfo.cookie.secure,
        httpOnly: changeInfo.cookie.httpOnly,
        sameSite: changeInfo.cookie.sameSite,
        expirationDate: changeInfo.cookie.expirationDate,
        session: changeInfo.cookie.session,
        storeId: changeInfo.cookie.storeId,
      },
      cause: changeInfo.cause,
    };

    browser.storage.local.get({ changeLog: [] }).then((data) => {
      const log = (data.changeLog as unknown[]) || [];
      log.unshift(entry);
      if (log.length > MAX_CHANGE_LOG) log.length = MAX_CHANGE_LOG;
      browser.storage.local.set({ changeLog: log });
    });
  });

  // Message handler
  browser.runtime.onMessage.addListener((msg: Record<string, unknown>, _sender) => {
    const action = msg.action as string;
    switch (action) {
      case 'getCookies': return handleGetCookies(msg);
      case 'setCookie': return handleSetCookie(msg);
      case 'deleteCookie': return handleDeleteCookie(msg);
      case 'deleteAllCookies': return handleDeleteAllCookies(msg);
      case 'getChangeLog': return handleGetChangeLog();
      case 'clearChangeLog': return handleClearChangeLog();
      case 'saveProfile': return handleSaveProfile(msg);
      case 'loadProfile': return handleLoadProfile(msg);
      case 'deleteProfile': return handleDeleteProfile(msg);
      case 'getProfiles': return handleGetProfiles();
      case 'exportCookies': return handleExportCookies(msg);
    }
  });

  // Cookie CRUD

  async function handleGetCookies(msg: Record<string, unknown>) {
    const url = msg.url as string | undefined;
    const domain = msg.domain as string | undefined;
    let cookies;
    if (url) {
      cookies = await browser.cookies.getAll({ url });
    } else if (domain) {
      cookies = await browser.cookies.getAll({ domain });
    } else {
      cookies = await browser.cookies.getAll({});
    }
    return { cookies: cookies || [] };
  }

  async function handleSetCookie(msg: Record<string, unknown>) {
    const details = msg.cookie as Record<string, unknown>;
    const protocol = details.secure ? 'https' : 'http';
    const domain = (details.domain as string).startsWith('.')
      ? (details.domain as string).slice(1)
      : details.domain as string;
    const url = `${protocol}://${domain}${details.path || '/'}`;

    const cookieData: browser.Cookies.SetDetailsType = {
      url,
      name: details.name as string,
      value: details.value as string,
      domain: details.domain as string,
      path: (details.path as string) || '/',
      secure: !!details.secure,
      httpOnly: !!details.httpOnly,
      sameSite: (details.sameSite as browser.Cookies.SameSiteStatus) || 'unspecified',
    };

    if (details.expirationDate && !details.session) {
      cookieData.expirationDate = details.expirationDate as number;
    }

    try {
      const cookie = await browser.cookies.set(cookieData);
      return { cookie };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  async function handleDeleteCookie(msg: Record<string, unknown>) {
    try {
      const removed = await browser.cookies.remove({
        name: msg.name as string,
        url: msg.url as string,
      });
      return { removed };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  async function handleDeleteAllCookies(msg: Record<string, unknown>) {
    const url = msg.url as string | undefined;
    const cookies = await browser.cookies.getAll(url ? { url } : {});
    let deleted = 0;
    for (const cookie of cookies) {
      const protocol = cookie.secure ? 'https' : 'http';
      const domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
      const cUrl = `${protocol}://${domain}${cookie.path}`;
      try {
        await browser.cookies.remove({ url: cUrl, name: cookie.name });
        deleted++;
      } catch {
        // skip failed deletions
      }
    }
    return { deleted };
  }

  // Change log

  async function handleGetChangeLog() {
    const data = await browser.storage.local.get({ changeLog: [] });
    return { changeLog: data.changeLog };
  }

  async function handleClearChangeLog() {
    await browser.storage.local.set({ changeLog: [] });
    return { success: true };
  }

  // Profiles

  async function handleSaveProfile(msg: Record<string, unknown>) {
    const name = msg.name as string;
    const url = msg.url as string | undefined;
    const cookies = await browser.cookies.getAll(url ? { url } : {});
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

  async function handleLoadProfile(msg: Record<string, unknown>) {
    const name = msg.name as string;
    const clearFirst = msg.clearFirst as boolean;
    const data = await browser.storage.local.get({ profiles: {} });
    const profiles = data.profiles as Record<string, { cookies: browser.Cookies.Cookie[]; url: string | null }>;
    const profile = profiles[name];

    if (!profile) return { error: 'Profile not found' };

    if (clearFirst && profile.url) {
      const existing = await browser.cookies.getAll({ url: profile.url });
      for (const cookie of existing) {
        const protocol = cookie.secure ? 'https' : 'http';
        const domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
        try {
          await browser.cookies.remove({ url: `${protocol}://${domain}${cookie.path}`, name: cookie.name });
        } catch {
          // skip
        }
      }
    }

    let restored = 0;
    for (const cookie of profile.cookies) {
      const protocol = cookie.secure ? 'https' : 'http';
      const domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
      const url = `${protocol}://${domain}${cookie.path}`;

      const cookieData: browser.Cookies.SetDetailsType = {
        url,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite || 'unspecified',
      };

      if (cookie.expirationDate && !cookie.session) {
        cookieData.expirationDate = cookie.expirationDate;
      }

      try {
        await browser.cookies.set(cookieData);
        restored++;
      } catch {
        // skip
      }
    }
    return { restored };
  }

  async function handleDeleteProfile(msg: Record<string, unknown>) {
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

  // Export

  async function handleExportCookies(msg: Record<string, unknown>) {
    const url = msg.url as string | undefined;
    const format = msg.format as string;
    const cookies = await browser.cookies.getAll(url ? { url } : {});

    let result: string;
    switch (format) {
      case 'json':
        result = JSON.stringify(cookies, null, 2);
        break;
      case 'netscape':
        result = toNetscape(cookies);
        break;
      case 'curl':
        result = toCurl(cookies, url);
        break;
      case 'header':
        result = toHeaderString(cookies);
        break;
      default:
        result = JSON.stringify(cookies, null, 2);
    }
    return { result };
  }
});
