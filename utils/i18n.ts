// UI strings. English lives in public/_locales/en/messages.json and every page reads it through
// browser.i18n, so a locale without a key falls back to English (default_locale); translating the UI
// means adding that locale's keys. Keys are typed from the English file.
import type en from '../public/_locales/en/messages.json';

export type MessageKey = keyof typeof en;
/** Keys that come as a `<key>_one` / `<key>_other` pair, named without the suffix. */
export type PluralKey = { [K in MessageKey]: K extends `${infer Base}_one` ? Base : never }[MessageKey];
export type Substitution = string | number;

export interface MessageEntry {
  message: string;
  description?: string;
  placeholders?: Record<string, { content: string; example?: string }>;
}

type Lookup = (key: string, substitutions: string[]) => string;

// WXT types getMessage's key from the English file; keys here are already checked as MessageKey.
let lookup: Lookup = (key, substitutions) => (browser.i18n.getMessage as (key: string, substitutions: string[]) => string)(key, substitutions);

/** Replaces browser.i18n as the source of messages; tests use it, since Node has no browser.i18n. */
export function setMessageLookup(next: Lookup): void {
  lookup = next;
}

export function t(key: MessageKey, ...substitutions: Substitution[]): string {
  return lookup(key, substitutions.map(String));
}

/** Picks `<key>_one` or `<key>_other` for `count`, which is also the first substitution. */
export function tp(key: PluralKey, count: number, ...rest: Substitution[]): string {
  return t(`${key}_${count === 1 ? 'one' : 'other'}` as MessageKey, count, ...rest);
}

/**
 * What chrome.i18n.getMessage returns for an entry: each $NAME$ becomes its placeholder's content with
 * $1–$9 filled from the substitutions, and $$ becomes $. One pass, so substituted text is never re-read.
 */
export function formatMessage(entry: MessageEntry, substitutions: string[] = []): string {
  const placeholders = new Map(Object.entries(entry.placeholders ?? {}).map(([name, p]) => [name.toLowerCase(), p.content]));
  return entry.message.replace(/\$\$|\$([A-Za-z0-9_@]+)\$/g, (match, name: string | undefined) => {
    if (!name) return '$';
    const content = placeholders.get(name.toLowerCase());
    if (content === undefined) return match;
    return content.replace(/\$\$|\$([1-9])/g, (m, digit: string | undefined) => (digit ? substitutions[Number(digit) - 1] ?? '' : '$'));
  });
}
