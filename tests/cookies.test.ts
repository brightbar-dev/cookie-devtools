import { describe, it, expect } from 'vitest';
import {
  toNetscape, toCurl, toHeaderString, cookieUrl, escapeHtml,
  formatExpiry, filterCookies, getBadges, cookieBadges, sameSiteLabel,
  toDatetimeLocal, fromDatetimeLocal, isPartitioned, domainAppliesToHost,
  CAUSE_MAP,
} from '../utils/cookies';
import type { CookieLike } from '../utils/cookies';

// --- Netscape Cookie Format ---

describe('toNetscape', () => {
  it('produces header and cookie line', () => {
    const result = toNetscape([{
      domain: '.example.com', path: '/', secure: true,
      expirationDate: 1700000000, name: 'session', value: 'abc123',
      httpOnly: false,
    }]);
    expect(result).toContain('# Netscape HTTP Cookie File');
    expect(result).toContain('.example.com\tTRUE');
    expect(result).toContain('\tTRUE\t1700000000');
    expect(result).toContain('session\tabc123');
  });

  it('uses FALSE flag for domain without dot', () => {
    const result = toNetscape([{
      domain: 'example.com', path: '/', secure: false,
      expirationDate: 0, name: 'test', value: 'val', httpOnly: false,
    }]);
    expect(result).toContain('example.com\tFALSE');
    expect(result).toContain('\tFALSE\t0');
  });

  it('handles multiple cookies', () => {
    const result = toNetscape([
      { domain: '.a.com', path: '/', secure: true, expirationDate: 100, name: 'a', value: '1', httpOnly: false },
      { domain: '.b.com', path: '/api', secure: false, expirationDate: 200, name: 'b', value: '2', httpOnly: false },
    ]);
    expect(result).toContain('a\t1');
    expect(result).toContain('b\t2');
    expect(result).toContain('/api');
  });

  it('handles empty array', () => {
    const result = toNetscape([]);
    expect(result.split('\n')).toHaveLength(3);
  });

  it('treats null expiration as 0', () => {
    const result = toNetscape([{
      domain: '.example.com', path: '/', secure: false,
      expirationDate: null, name: 'sess', value: 'x', httpOnly: false,
    }]);
    expect(result).toContain('\t0\tsess');
  });

  it('preserves special characters in value', () => {
    const result = toNetscape([{
      domain: '.example.com', path: '/', secure: false,
      expirationDate: 100, name: 'token', value: 'abc=def;ghi', httpOnly: false,
    }]);
    expect(result).toContain('abc=def;ghi');
  });

  it('marks HttpOnly cookies with the #HttpOnly_ prefix', () => {
    const result = toNetscape([{ domain: 'example.com', path: '/', secure: true, expirationDate: 0, name: 'sid', value: 'x', httpOnly: true }]);
    expect(result.split('\n')[3]).toBe('#HttpOnly_example.com\tFALSE\t/\tTRUE\t0\tsid\tx');
  });

  it('handles empty name/value', () => {
    const result = toNetscape([{
      domain: '.example.com', path: '/', secure: false,
      expirationDate: 100, name: '', value: '', httpOnly: false,
    }]);
    expect(result).toContain('\t\t');
  });
});

// --- curl Export ---

describe('toCurl', () => {
  it('formats single cookie with URL', () => {
    expect(toCurl([{ name: 'sid', value: '123', domain: '', path: '', secure: false, httpOnly: false }], 'https://api.example.com/v1'))
      .toBe("curl -b 'sid=123' 'https://api.example.com/v1'");
  });

  it('joins multiple cookies with semicolon', () => {
    const cookies = [
      { name: 'a', value: '1', domain: '', path: '', secure: false, httpOnly: false },
      { name: 'b', value: '2', domain: '', path: '', secure: false, httpOnly: false },
      { name: 'c', value: '3', domain: '', path: '', secure: false, httpOnly: false },
    ];
    expect(toCurl(cookies, 'https://test.com'))
      .toBe("curl -b 'a=1; b=2; c=3' 'https://test.com'");
  });

  it('returns comment for empty cookies', () => {
    expect(toCurl([], 'https://test.com')).toBe('# No cookies found');
  });

  it('uses default URL when null', () => {
    const result = toCurl([{ name: 'x', value: 'y', domain: '', path: '', secure: false, httpOnly: false }], null);
    expect(result).toContain('https://example.com');
  });

  it('preserves equals in value', () => {
    const result = toCurl([{ name: 'token', value: 'abc=def', domain: '', path: '', secure: false, httpOnly: false }], 'https://test.com');
    expect(result).toContain('token=abc=def');
  });

  it('quotes a single quote for the shell', () => {
    const result = toCurl([{ name: 'q', value: "it's", domain: '', path: '', secure: false, httpOnly: false }], 'https://test.com');
    expect(result).toBe("curl -b 'q=it'\\''s' 'https://test.com'");
  });

  it('handles unicode value', () => {
    const result = toCurl([{ name: 'lang', value: '日本語', domain: '', path: '', secure: false, httpOnly: false }], 'https://test.com');
    expect(result).toContain('日本語');
  });
});

// --- Cookie Header String ---

describe('toHeaderString', () => {
  it('formats single cookie', () => {
    expect(toHeaderString([{ name: 'a', value: '1', domain: '', path: '', secure: false, httpOnly: false }])).toBe('a=1');
  });

  it('joins multiple cookies', () => {
    expect(toHeaderString([
      { name: 'a', value: '1', domain: '', path: '', secure: false, httpOnly: false },
      { name: 'b', value: '2', domain: '', path: '', secure: false, httpOnly: false },
    ])).toBe('a=1; b=2');
  });

  it('returns empty for no cookies', () => {
    expect(toHeaderString([])).toBe('');
  });

  it('preserves special chars', () => {
    expect(toHeaderString([{ name: 'tok', value: 'a=b;c', domain: '', path: '', secure: false, httpOnly: false }])).toBe('tok=a=b;c');
  });

  it('no semicolons for single cookie', () => {
    const result = toHeaderString([{ name: 'only', value: 'one', domain: '', path: '', secure: false, httpOnly: false }]);
    expect(result).not.toContain(';');
  });
});

// --- Cookie URL Construction ---

describe('cookieUrl', () => {
  it('builds https URL with dot domain', () => {
    expect(cookieUrl({ secure: true, domain: '.example.com', path: '/' })).toBe('https://example.com/');
  });

  it('builds http URL without dot', () => {
    expect(cookieUrl({ secure: false, domain: 'example.com', path: '/' })).toBe('http://example.com/');
  });

  it('preserves path', () => {
    expect(cookieUrl({ secure: true, domain: '.api.example.com', path: '/v1' })).toBe('https://api.example.com/v1');
  });

  it('handles subdomain with deep path', () => {
    expect(cookieUrl({ secure: false, domain: '.sub.domain.com', path: '/a/b' })).toBe('http://sub.domain.com/a/b');
  });

  it('root path ends with /', () => {
    const url = cookieUrl({ secure: true, domain: '.example.com', path: '/' });
    expect(url).toMatch(/\/$/);
  });
});

// --- HTML Escaping ---

describe('escapeHtml', () => {
  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes ampersand', () => {
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });

  it('escapes quotes', () => {
    expect(escapeHtml('a"b')).toBe('a&quot;b');
  });

  it('leaves safe text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('escapes multiple entities', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
});

// --- Expiry Formatting ---

describe('formatExpiry', () => {
  it('returns Session for session cookie', () => {
    expect(formatExpiry({ session: true })).toBe('Session');
  });

  it('returns Session for null expirationDate', () => {
    expect(formatExpiry({ session: false, expirationDate: null })).toBe('Session');
  });

  it('returns Session for undefined expirationDate', () => {
    expect(formatExpiry({ session: false })).toBe('Session');
  });

  it('formats valid date', () => {
    const result = formatExpiry({ session: false, expirationDate: 1700000000 });
    expect(result.length).toBeGreaterThan(0);
  });
});

// --- Cookie Filtering ---

describe('filterCookies', () => {
  const testCookies: CookieLike[] = [
    { name: 'session_id', value: 'abc123', domain: '.example.com', path: '/', secure: false, httpOnly: false },
    { name: 'theme', value: 'dark', domain: '.example.com', path: '/', secure: false, httpOnly: false },
    { name: 'auth_token', value: 'xyz789', domain: '.api.example.com', path: '/', secure: false, httpOnly: false },
    { name: 'tracker', value: 'ga_123', domain: '.analytics.com', path: '/', secure: false, httpOnly: false },
  ];

  it('filters by name', () => expect(filterCookies(testCookies, 'session')).toHaveLength(1));
  it('filters by value', () => expect(filterCookies(testCookies, 'dark')).toHaveLength(1));
  it('filters by domain', () => expect(filterCookies(testCookies, 'analytics')).toHaveLength(1));
  it('handles partial match', () => expect(filterCookies(testCookies, 'auth')).toHaveLength(1));
  it('is case insensitive', () => expect(filterCookies(testCookies, 'THEME')).toHaveLength(1));
  it('matches multiple', () => expect(filterCookies(testCookies, 'example')).toHaveLength(3));
  it('returns all for empty filter', () => expect(filterCookies(testCookies, '')).toHaveLength(4));
  it('returns empty for no match', () => expect(filterCookies(testCookies, 'nonexistent')).toHaveLength(0));

  it('handles special regex chars without crashing', () => {
    const result = filterCookies(testCookies, '.*+?^${}()|[]\\');
    expect(Array.isArray(result)).toBe(true);
  });
});

// --- Badge Generation ---

describe('getBadges', () => {
  it('generates secure+httpOnly+strict badges', () => {
    const b = getBadges({ secure: true, httpOnly: true, session: false, sameSite: 'strict' });
    expect(b).toHaveLength(3);
    expect(b).toContain('S');
    expect(b).toContain('H');
    expect(b).toContain('Strict');
  });

  it('generates session+lax badges', () => {
    const b = getBadges({ secure: false, httpOnly: false, session: true, sameSite: 'lax' });
    expect(b).toHaveLength(2);
    expect(b).toContain('Ses');
    expect(b).toContain('Lax');
  });

  it('shows None for no_restriction', () => {
    const b = getBadges({ secure: false, httpOnly: false, session: false, sameSite: 'no_restriction' });
    expect(b).toEqual(['None']);
  });

  it('generates nothing for unspecified', () => {
    expect(getBadges({ secure: false, httpOnly: false, session: false, sameSite: 'unspecified' })).toHaveLength(0);
  });

  it('generates all flags', () => {
    const b = getBadges({ secure: true, httpOnly: true, session: true, sameSite: 'strict' });
    expect(b).toHaveLength(4);
  });
});

// --- SameSite Label ---

describe('sameSiteLabel', () => {
  it('capitalizes strict', () => expect(sameSiteLabel('strict')).toBe('Strict'));
  it('capitalizes lax', () => expect(sameSiteLabel('lax')).toBe('Lax'));
  it('maps no_restriction to None', () => expect(sameSiteLabel('no_restriction')).toBe('None'));
  it('returns null for unspecified', () => expect(sameSiteLabel('unspecified')).toBeNull());
  it('returns null for null', () => expect(sameSiteLabel(null)).toBeNull());
  it('returns null for undefined', () => expect(sameSiteLabel(undefined)).toBeNull());
});

// --- Partitioned cookies ---

describe('cookieUrl for partitioned cookies', () => {
  it('follows the top-level site scheme for a first-party partitioned cookie (http loopback)', () => {
    const pk = { topLevelSite: 'http://127.0.0.1', hasCrossSiteAncestor: false };
    expect(cookieUrl({ secure: true, domain: '127.0.0.1', path: '/', partitionKey: pk })).toBe('http://127.0.0.1/');
  });

  it('follows the site scheme for a subdomain of the top-level site', () => {
    const pk = { topLevelSite: 'https://example.com', hasCrossSiteAncestor: false };
    expect(cookieUrl({ secure: true, domain: 'app.example.com', path: '/a', partitionKey: pk })).toBe('https://app.example.com/a');
  });

  it('uses https for a partitioned cookie set from a cross-site frame', () => {
    const pk = { topLevelSite: 'http://127.0.0.1', hasCrossSiteAncestor: true };
    expect(cookieUrl({ secure: true, domain: 'localhost', path: '/', partitionKey: pk })).toBe('https://localhost/');
  });

  it('ignores a partition whose site is a different host', () => {
    const pk = { topLevelSite: 'http://other.test' };
    expect(cookieUrl({ secure: true, domain: 'widget.test', path: '/', partitionKey: pk })).toBe('https://widget.test/');
  });

  it('defaults an empty path to /', () => {
    expect(cookieUrl({ secure: false, domain: 'example.com', path: '' })).toBe('http://example.com/');
  });
});

describe('isPartitioned', () => {
  it('is true only with a top-level site', () => {
    expect(isPartitioned({ partitionKey: { topLevelSite: 'https://a.com' } })).toBe(true);
    expect(isPartitioned({ partitionKey: {} })).toBe(false);
    expect(isPartitioned({ partitionKey: null })).toBe(false);
    expect(isPartitioned({})).toBe(false);
  });
});

describe('cookieBadges', () => {
  it('adds a P badge naming the partition', () => {
    const badges = cookieBadges({ secure: true, httpOnly: false, session: false, sameSite: 'no_restriction', partitionKey: { topLevelSite: 'https://shop.test', hasCrossSiteAncestor: true } });
    const p = badges.find((b) => b.label === 'P')!;
    expect(p.kind).toBe('partitioned');
    expect(p.title).toContain('https://shop.test');
    expect(p.title).toContain('cross-site');
  });

  it('gives every badge a class kind and a tooltip', () => {
    for (const b of cookieBadges({ secure: true, httpOnly: true, session: true, sameSite: 'strict' })) {
      expect(b.kind).toMatch(/^[a-z_-]+$/);
      expect(b.title.length).toBeGreaterThan(3);
    }
  });
});

describe('domainAppliesToHost', () => {
  it('matches the same host and parent domains', () => {
    expect(domainAppliesToHost('app.example.com', 'app.example.com')).toBe(true);
    expect(domainAppliesToHost('.example.com', 'app.example.com')).toBe(true);
  });

  it('does not match subdomains, lookalikes or empty domains', () => {
    expect(domainAppliesToHost('api.example.com', 'example.com')).toBe(false);
    expect(domainAppliesToHost('ample.com', 'example.com')).toBe(false);
    expect(domainAppliesToHost('', 'example.com')).toBe(false);
  });
});

// --- datetime-local conversion ---

describe('toDatetimeLocal / fromDatetimeLocal', () => {
  it('round-trips a minute-precision local time exactly (no UTC-offset drift)', () => {
    const secs = fromDatetimeLocal('2026-09-15T10:30')!;
    expect(toDatetimeLocal(secs)).toBe('2026-09-15T10:30');
    expect(fromDatetimeLocal(toDatetimeLocal(secs))).toBe(secs);
  });

  it('formats in local time, matching the Date fields', () => {
    const secs = 1820979829.5;
    const d = new Date(secs * 1000);
    expect(toDatetimeLocal(secs)).toBe(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    );
  });

  it('returns null for blank or invalid input', () => {
    expect(fromDatetimeLocal('')).toBeNull();
    expect(fromDatetimeLocal('not a date')).toBeNull();
  });
});

// --- Cause Map ---

describe('CAUSE_MAP', () => {
  it('has all 5 causes', () => {
    expect(Object.keys(CAUSE_MAP)).toHaveLength(5);
  });

  it('has explicit', () => expect(CAUSE_MAP.explicit).toBe('Set/deleted by page or extension'));
  it('has overwrite', () => expect(CAUSE_MAP.overwrite).toBe('Overwritten by new value'));
  it('has expired', () => expect(CAUSE_MAP.expired).toBe('Expired'));
  it('has evicted', () => expect(CAUSE_MAP.evicted).toBe('Evicted (storage limit)'));
  it('has expired_overwrite', () => expect(CAUSE_MAP.expired_overwrite).toBe('Expired and overwritten'));
});

// --- Change Log Truncation ---

describe('change log truncation', () => {
  it('caps at MAX_CHANGE_LOG', () => {
    const MAX_CHANGE_LOG = 500;
    const log: { timestamp: number }[] = [];
    for (let i = 0; i < 600; i++) {
      log.unshift({ timestamp: i });
      if (log.length > MAX_CHANGE_LOG) log.length = MAX_CHANGE_LOG;
    }
    expect(log).toHaveLength(500);
    expect(log[0]!.timestamp).toBe(599);
    expect(log[499]!.timestamp).toBe(100);
  });
});
