// Export formats, the text each produces, and a download filename.
import { toNetscape, toCurl, toHeaderString } from './cookies';
import type { CookieLike } from './cookies';
import { t } from './i18n';

export type ExportFormat = 'json' | 'netscape' | 'curl' | 'header';

export interface ExportFormatInfo {
  id: ExportFormat;
  mime: string;
  suffix: string;
}

export const EXPORT_FORMATS: ExportFormatInfo[] = [
  { id: 'json', mime: 'application/json', suffix: '.json' },
  { id: 'netscape', mime: 'text/plain', suffix: '.cookies.txt' },
  { id: 'curl', mime: 'text/x-shellscript', suffix: '.curl.sh' },
  { id: 'header', mime: 'text/plain', suffix: '.header.txt' },
];

export function exportFormatLabel(format: ExportFormat): string {
  switch (format) {
    case 'json': return t('exportFormatJson');
    case 'netscape': return t('exportFormatNetscape');
    case 'curl': return t('exportFormatCurl');
    case 'header': return t('exportFormatHeader');
  }
}

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
