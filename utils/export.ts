// Export formats, the text each produces, and a download filename.
import { toNetscape, toCurl, toHeaderString } from './cookies';
import type { CookieLike } from './cookies';

export type ExportFormat = 'json' | 'netscape' | 'curl' | 'header';

export interface ExportFormatInfo {
  id: ExportFormat;
  label: string;
  mime: string;
  suffix: string;
}

export const EXPORT_FORMATS: ExportFormatInfo[] = [
  { id: 'json', label: 'JSON', mime: 'application/json', suffix: '.json' },
  { id: 'netscape', label: 'cookies.txt (curl/wget)', mime: 'text/plain', suffix: '.cookies.txt' },
  { id: 'curl', label: 'curl command', mime: 'text/x-shellscript', suffix: '.curl.sh' },
  { id: 'header', label: 'Cookie header', mime: 'text/plain', suffix: '.header.txt' },
];

export function formatExport(format: ExportFormat, cookies: CookieLike[], url?: string | null): string {
  switch (format) {
    case 'json': return JSON.stringify(cookies, null, 2);
    case 'netscape': return toNetscape(cookies);
    case 'curl': return toCurl(cookies, url);
    case 'header': return toHeaderString(cookies);
  }
}

export function exportFilename(format: ExportFormat, host: string, date: Date): string {
  const safeHost = (host || 'all-sites').replace(/[^a-z0-9.-]+/gi, '_');
  const info = EXPORT_FORMATS.find((f) => f.id === format)!;
  return `cookies-${safeHost}-${date.toISOString().slice(0, 10)}${info.suffix}`;
}
