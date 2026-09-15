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
