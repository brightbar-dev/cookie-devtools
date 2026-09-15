import { describe, it, expect } from 'vitest';
import { EXPORT_FORMATS, formatExport, exportFilename } from '../utils/export';
import type { CookieLike } from '../utils/cookies';

const cookies: CookieLike[] = [
  { name: 'a', value: '1', domain: 'example.com', hostOnly: true, path: '/', secure: true, httpOnly: false, sameSite: 'lax', session: true },
  { name: 'b', value: '2', domain: '.example.com', hostOnly: false, path: '/', secure: false, httpOnly: true, sameSite: 'strict', session: false, expirationDate: 1900000000 },
];

describe('formatExport', () => {
  it('produces each format from the given cookies only', () => {
    expect(JSON.parse(formatExport('json', cookies))).toEqual(cookies);
    expect(formatExport('header', cookies)).toBe('a=1; b=2');
    expect(formatExport('curl', cookies, 'https://example.com/x')).toBe("curl -b 'a=1; b=2' 'https://example.com/x'");
    expect(formatExport('netscape', [cookies[1]!])).toContain('#HttpOnly_.example.com\tTRUE\t/\tFALSE\t1900000000\tb\t2');
  });

  it('exports an empty selection without failing', () => {
    expect(formatExport('json', [])).toBe('[]');
    expect(formatExport('header', [])).toBe('');
  });
});

describe('exportFilename', () => {
  const date = new Date('2026-09-15T12:00:00Z');

  it('names the file after the site, day and format', () => {
    expect(exportFilename('json', 'app.example.com', date)).toBe('cookies-app.example.com-2026-09-15.json');
    expect(exportFilename('netscape', 'app.example.com', date)).toBe('cookies-app.example.com-2026-09-15.cookies.txt');
    expect(exportFilename('curl', '127.0.0.1', date)).toBe('cookies-127.0.0.1-2026-09-15.curl.sh');
  });

  it('keeps the filename safe', () => {
    expect(exportFilename('header', '', date)).toBe('cookies-all-sites-2026-09-15.header.txt');
    expect(exportFilename('json', '[::1]', date)).toBe('cookies-_1_-2026-09-15.json');
  });

  it('has a filename suffix and MIME type for every format', () => {
    for (const f of EXPORT_FORMATS) {
      expect(f.suffix).toMatch(/^\.[a-z.]+$/);
      expect(f.mime).toContain('/');
    }
  });
});
