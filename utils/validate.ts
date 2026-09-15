// Pre-submit validation for the cookie editor. Every error mirrors a write the browser rejects,
// verified against chrome.cookies.set in Chrome for Testing 151.
import { t } from './i18n';

export type Severity = 'error' | 'warning' | 'confirm';
export type Field = 'name' | 'value' | 'domain' | 'path' | 'expires' | 'sameSite';

export interface Issue {
  field: Field;
  severity: Severity;
  code: string;
  message: string;
}

export interface CookieDraft {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  session: boolean;
  expirationDate: number | null;
  partitioned: boolean;
}

export const MAX_NAME_VALUE_BYTES = 4096;
export const SIZE_WARNING_BYTES = 3800;
export const MAX_ATTRIBUTE_BYTES = 1024;
export const MAX_EXPIRY_DAYS = 400;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function byteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

export function cookieSize(name: string, value: string): number {
  return byteLength(name) + byteLength(value);
}

export interface ValidateOptions {
  nowSeconds: number;
  /** An existing cookie with an empty name may be edited; a new one may not be created. */
  allowEmptyName?: boolean;
}

export function validateCookie(draft: CookieDraft, opts: ValidateOptions): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Severity, field: Field, code: string, message: string) =>
    issues.push({ field, severity, code, message });

  const { name, value, path } = draft;
  const domain = draft.domain.trim();

  if (!name && !opts.allowEmptyName) add('error', 'name', 'required', t('validateNameRequired'));
  if (CONTROL_CHARS.test(name)) add('error', 'name', 'name-control', t('validateNameControl'));
  if (/[;=]/.test(name)) add('error', 'name', 'name-separator', t('validateNameSeparator'));
  if (name && name !== name.trim()) add('warning', 'name', 'name-whitespace', t('validateNameWhitespace'));

  if (CONTROL_CHARS.test(value)) add('error', 'value', 'value-control', t('validateValueControl'));
  if (value.includes(';')) add('error', 'value', 'value-semicolon', t('validateValueSemicolon'));

  const size = cookieSize(name, value);
  if (size > MAX_NAME_VALUE_BYTES) {
    add('error', 'value', 'too-large', t('validateTooLarge', size, MAX_NAME_VALUE_BYTES));
  } else if (size > SIZE_WARNING_BYTES) {
    add('warning', 'value', 'near-limit', t('validateNearLimit', size, MAX_NAME_VALUE_BYTES));
  }

  if (!domain) {
    add('error', 'domain', 'required', t('validateDomainRequired'));
  } else if (/[\s/:?#@]/.test(domain)) {
    add('error', 'domain', 'domain-format', t('validateDomainFormat'));
  } else if (byteLength(domain) > MAX_ATTRIBUTE_BYTES) {
    add('error', 'domain', 'domain-length', t('validateDomainLength', MAX_ATTRIBUTE_BYTES));
  }

  if (!path.startsWith('/')) add('error', 'path', 'path-format', t('validatePathFormat'));
  else if (byteLength(path) > MAX_ATTRIBUTE_BYTES) add('error', 'path', 'path-length', t('validatePathLength', MAX_ATTRIBUTE_BYTES));

  if (draft.sameSite === 'no_restriction' && !draft.secure) {
    add('error', 'sameSite', 'samesite-none-insecure', t('validateSameSiteNoneInsecure'));
  }
  if (draft.partitioned && !draft.secure) {
    add('error', 'sameSite', 'partitioned-insecure', t('validatePartitionedInsecure'));
  }

  // Cookie prefixes are matched case-insensitively.
  const lower = name.toLowerCase();
  if (lower.startsWith('__secure-') && !draft.secure) {
    add('error', 'name', 'secure-prefix', t('validateSecurePrefix'));
  }
  if (lower.startsWith('__host-')) {
    if (!draft.secure) add('error', 'name', 'host-prefix-secure', t('validateHostPrefixSecure'));
    if (path !== '/') add('error', 'path', 'host-prefix-path', t('validateHostPrefixPath'));
    if (!draft.hostOnly) add('error', 'domain', 'host-prefix-domain', t('validateHostPrefixDomain'));
  }

  if (!draft.session) {
    if (draft.expirationDate === null) {
      add('error', 'expires', 'expiry-missing', t('validateExpiryMissing'));
    } else if (draft.expirationDate <= opts.nowSeconds) {
      add('confirm', 'expires', 'expiry-past', t('validateExpiryPast'));
    } else if (draft.expirationDate - opts.nowSeconds > MAX_EXPIRY_DAYS * 86400) {
      add('warning', 'expires', 'expiry-capped', t('validateExpiryCapped', MAX_EXPIRY_DAYS));
    }
  }

  return issues;
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

export function needsConfirmation(issues: Issue[]): boolean {
  return issues.some((i) => i.severity === 'confirm');
}
