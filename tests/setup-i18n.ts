// Node has no browser.i18n: serve UI strings from the English messages file, filled the way Chrome fills them.
import en from '../public/_locales/en/messages.json';
import { formatMessage, setMessageLookup } from '../utils/i18n';
import type { MessageEntry } from '../utils/i18n';

const messages = en as Record<string, MessageEntry>;

setMessageLookup((key, substitutions) => {
  const entry = messages[key];
  if (!entry) throw new Error(`No "${key}" in public/_locales/en/messages.json`);
  return formatMessage(entry, substitutions);
});
