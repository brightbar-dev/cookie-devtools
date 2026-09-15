// The page a cookie view works on.
import { t } from './i18n';

export interface PageTarget {
  /** Origin + path: what cookies.getAll({url}) matches against. */
  url: string;
  host: string;
  https: boolean;
}

/** An http(s) page as a cookie target, or null for pages without cookies (chrome://, file://, about:). */
export function parseTarget(raw: string | undefined | null): PageTarget | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return { url: url.origin + url.pathname, host: url.hostname, https: url.protocol === 'https:' };
}

/**
 * The match pattern for host access to a page's site: scheme and host, any port and path. Chrome lets a user
 * withhold host access (Site access: "On click" or "On specific sites"); permissions.contains/request take this.
 */
export function siteAccessPattern(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.hostname}/*`;
}

/** Whether a tabs.onUpdated change can mean a different page: a new URL, or a load that finished. */
export function tabUpdateMovesTarget(info: { url?: string; status?: string }): boolean {
  return !!info.url || info.status === 'complete';
}

const BROWSER_SCHEMES = new Set([
  'chrome:', 'chrome-extension:', 'chrome-search:', 'chrome-untrusted:', 'devtools:', 'edge:', 'brave:',
  'opera:', 'vivaldi:', 'about:', 'moz-extension:', 'view-source:',
]);

/** Why there is nothing to show when a page has no cookie target, for the empty state. */
export function noTargetReason(raw: string | undefined | null): { title: string; detail: string } {
  if (!raw) {
    return { title: t('targetNoPageTitle'), detail: t('targetNoPageDetail') };
  }
  let protocol: string;
  try {
    protocol = new URL(raw).protocol;
  } catch {
    return { title: t('targetNotWebsiteTitle'), detail: t('targetNotWebsiteDetail') };
  }
  if (BROWSER_SCHEMES.has(protocol)) {
    return {
      title: t('targetBrowserPageTitle'),
      detail: t('targetBrowserPageDetail'),
    };
  }
  if (protocol === 'file:') {
    return {
      title: t('targetLocalFileTitle'),
      detail: t('targetLocalFileDetail'),
    };
  }
  return { title: t('targetNotWebsiteTitle'), detail: t('targetOnlyHttpDetail') };
}
