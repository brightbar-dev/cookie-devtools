// The page a cookie view works on.

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

const BROWSER_SCHEMES = new Set([
  'chrome:', 'chrome-extension:', 'chrome-search:', 'chrome-untrusted:', 'devtools:', 'edge:', 'brave:',
  'opera:', 'vivaldi:', 'about:', 'moz-extension:', 'view-source:',
]);

/** Why there is nothing to show when a page has no cookie target, for the empty state. */
export function noTargetReason(raw: string | undefined | null): { title: string; detail: string } {
  if (!raw) {
    return { title: 'No page open', detail: 'Open a website in this window to see its cookies.' };
  }
  let protocol: string;
  try {
    protocol = new URL(raw).protocol;
  } catch {
    return { title: 'Not a website', detail: 'Open a website to see its cookies.' };
  }
  if (BROWSER_SCHEMES.has(protocol)) {
    return {
      title: 'Browser page',
      detail: 'Browser pages such as settings, extensions and the new tab page have no cookies. Open a website to see its cookies.',
    };
  }
  if (protocol === 'file:') {
    return {
      title: 'Local file',
      detail: 'Files opened from your computer don’t use cookies. Serve the file from localhost to work with its cookies.',
    };
  }
  return { title: 'Not a website', detail: 'Only http and https pages have cookies.' };
}
