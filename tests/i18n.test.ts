/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';
import en from '../public/_locales/en/messages.json';
import { formatMessage } from '../utils/i18n';
import type { MessageEntry } from '../utils/i18n';

const messages = en as Record<string, MessageEntry>;

// Every source file that can show text, as written (Vite's ?raw), keyed like 'ui/app.ts'.
const RAW = import.meta.glob(['../ui/**/*.{ts,html}', '../utils/**/*.ts', '../entrypoints/**/*.{ts,html}', '../wxt.config.ts'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;
const TEXT = Object.fromEntries(Object.entries(RAW).map(([file, src]) => [file.replace(/^\.\.\//, ''), src]));
const SOURCES = Object.keys(TEXT).filter((f) => f !== 'wxt.config.ts');
const read = (f: string) => TEXT[f]!;

/** Every message key the code asks for, with where it is asked for. */
function usedKeys(): Map<string, string> {
  const used = new Map<string, string>();
  for (const file of Object.keys(TEXT)) {
    const src = read(file);
    for (const m of src.matchAll(/\bt\('([A-Za-z0-9_]+)'/g)) used.set(m[1]!, file);
    for (const m of src.matchAll(/\btp\('([A-Za-z0-9_]+)'/g)) {
      used.set(`${m[1]}_one`, file);
      used.set(`${m[1]}_other`, file);
    }
    for (const m of src.matchAll(/data-i18n(?:-[a-z-]+)?="([A-Za-z0-9_]+)"/g)) used.set(m[1]!, file);
    for (const m of src.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) used.set(m[1]!, file);
  }
  return used;
}

describe('UI strings (public/_locales/en/messages.json)', () => {
  it('has every key that t(), tp() and data-i18n attributes use', () => {
    const missing = [...usedKeys()].filter(([key]) => !(key in messages)).map(([key, file]) => `${key} (${file})`);
    expect(missing).toEqual([]);
  });

  it('has no message that nothing uses', () => {
    const used = usedKeys();
    expect(Object.keys(messages).filter((key) => !used.has(key))).toEqual([]);
  });

  it('defines exactly the placeholders each message uses, numbered $1…$n', () => {
    const problems: string[] = [];
    for (const [key, entry] of Object.entries(messages)) {
      const inMessage = new Set([...entry.message.matchAll(/\$([A-Za-z0-9_]+)\$/g)].map((m) => m[1]!.toLowerCase()));
      const defined = Object.keys(entry.placeholders ?? {}).map((name) => name.toLowerCase());
      if (inMessage.size !== defined.length || !defined.every((name) => inMessage.has(name))) problems.push(`${key}: placeholders`);
      const contents = Object.values(entry.placeholders ?? {}).map((p) => p.content).sort();
      if (contents.join() !== defined.map((_, i) => `$${i + 1}`).join()) problems.push(`${key}: contents ${contents.join()}`);
    }
    expect(problems).toEqual([]);
  });

  it('has both halves of every plural pair, with the count first', () => {
    const problems: string[] = [];
    for (const key of Object.keys(messages)) {
      const pair = /_one$/.test(key) ? key.replace(/_one$/, '_other') : /_other$/.test(key) ? key.replace(/_other$/, '_one') : null;
      if (pair === null) continue;
      if (!(pair in messages)) problems.push(`${key} has no ${pair}`);
      if (messages[key]!.placeholders?.count?.content !== '$1') problems.push(`${key}: $COUNT$ is not $1`);
    }
    expect(problems).toEqual([]);
  });
});

describe('formatMessage (what chrome.i18n.getMessage returns)', () => {
  const shownOf: MessageEntry = {
    message: '$SHOWN$ of $COUNT$ cookies',
    placeholders: { count: { content: '$1' }, shown: { content: '$2' } },
  };

  it('fills named placeholders from their numbered substitutions, in any order', () => {
    expect(formatMessage(shownOf, ['10', '3'])).toBe('3 of 10 cookies');
  });

  it('matches placeholder names case-insensitively and turns $$ into $', () => {
    expect(formatMessage({ message: 'Cost $$5 for $Name$', placeholders: { NAME: { content: '$1' } } }, ['x'])).toBe('Cost $5 for x');
  });

  it('never re-reads substituted text', () => {
    expect(formatMessage(shownOf, ['$2', '$$COUNT$'])).toBe('$$COUNT$ of $2 cookies');
  });

  it('leaves an undefined placeholder as written', () => {
    expect(formatMessage({ message: 'Hi $WHO$' }, [])).toBe('Hi $WHO$');
  });
});

describe('no user-facing English outside messages.json', () => {
  const LETTER = /\p{L}/u;

  function literalText(html: string): string {
    return html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#?\w+;/g, ' ')
      .replace(/__MSG_\w+__/g, ' ') // Chrome localizes these where WXT copies them into the manifest
      .trim();
  }

  const pages = [
    ...SOURCES.filter((f) => f.endsWith('.html')).map((f) => ({ file: f, html: read(f) })),
    { file: 'ui/markup.ts', html: read('ui/markup.ts').replace(/^[\s\S]*?`/, '').replace(/`;\s*$/, '') },
  ];

  it('markup and HTML pages carry no literal text', () => {
    const found = pages.filter((p) => LETTER.test(literalText(p.html))).map((p) => `${p.file}: ${literalText(p.html).slice(0, 80)}`);
    expect(found).toEqual([]);
  });

  it('markup and HTML pages set no literal title, aria-label, placeholder or alt', () => {
    const found = pages.flatMap((p) => [...p.html.matchAll(/\s(title|aria-label|placeholder|alt)="([^"]*)"/g)]
      .filter((m) => LETTER.test(m[2]!))
      .map((m) => `${p.file}: ${m[0].trim()}`));
    expect(found).toEqual([]);
  });

  it('UI code passes no string literal with words to the page', () => {
    const patterns = [
      /\b(?:toast|confirmDialog|alert|confirm)\(\s*(['"`])[^'"`]*\p{L}/u,
      /\.(?:textContent|title|placeholder)\s*=\s*(['"`])[^'"`]*\p{L}/u,
      /setAttribute\(\s*'(?:title|aria-label|placeholder)'\s*,\s*(['"`])[^'"`]*\p{L}/u,
      /\b(?:label|actionLabel|title|detail|reason|error|warning):\s*(['"`])[^'"`]*\p{L}/u,
    ];
    const code = SOURCES.filter((f) => f.endsWith('.ts') && (f.startsWith('ui') || f.startsWith('entrypoints')));
    const found = code.flatMap((file) => read(file).split('\n').flatMap((line: string, i: number) =>
      patterns.some((re) => re.test(line)) ? [`${file}:${i + 1}: ${line.trim()}`] : []));
    expect(found).toEqual([]);
  });
});
