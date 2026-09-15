import { describe, it, expect } from 'vitest';
import {
  validateCookie, hasErrors, needsConfirmation, byteLength, cookieSize,
} from '../utils/validate';
import type { CookieDraft, ValidateOptions } from '../utils/validate';

const NOW = 1_800_000_000;
const DAY = 86400;

const draft = (over: Partial<CookieDraft> = {}): CookieDraft => ({
  name: 'sid',
  value: 'abc',
  domain: 'example.com',
  hostOnly: true,
  path: '/',
  secure: false,
  httpOnly: false,
  sameSite: 'lax',
  session: true,
  expirationDate: null,
  partitioned: false,
  ...over,
});

const codes = (d: CookieDraft, opts: Partial<ValidateOptions> = {}) =>
  validateCookie(d, { nowSeconds: NOW, ...opts }).map((i) => i.code);

describe('validateCookie', () => {
  it('accepts an ordinary cookie', () => {
    expect(validateCookie(draft(), { nowSeconds: NOW })).toEqual([]);
  });

  describe('name', () => {
    it('requires a name for a new cookie', () => {
      const issues = validateCookie(draft({ name: '' }), { nowSeconds: NOW });
      expect(issues).toEqual([expect.objectContaining({ field: 'name', severity: 'error', code: 'required' })]);
    });

    it('allows editing an existing cookie that has an empty name', () => {
      expect(codes(draft({ name: '' }), { allowEmptyName: true })).toEqual([]);
    });

    it('rejects ; and = (the browser refuses them)', () => {
      expect(codes(draft({ name: 'a=b' }))).toContain('name-separator');
      expect(codes(draft({ name: 'a;b' }))).toContain('name-separator');
    });

    it('rejects control characters', () => {
      expect(codes(draft({ name: 'a\tb' }))).toContain('name-control');
    });

    it('accepts spaces and parentheses inside a name (the browser does)', () => {
      expect(codes(draft({ name: 'a b(c)' }))).toEqual([]);
    });

    it('warns about leading or trailing spaces', () => {
      const issues = validateCookie(draft({ name: ' sid' }), { nowSeconds: NOW });
      expect(issues).toEqual([expect.objectContaining({ code: 'name-whitespace', severity: 'warning' })]);
    });
  });

  describe('value', () => {
    it('rejects ; and line breaks', () => {
      expect(codes(draft({ value: 'a;b' }))).toContain('value-semicolon');
      expect(codes(draft({ value: 'a\nb' }))).toContain('value-control');
    });

    it('accepts spaces, quotes and unicode', () => {
      expect(codes(draft({ value: 'a "b" héllo 日本' }))).toEqual([]);
    });
  });

  describe('size', () => {
    it('accepts exactly 4096 bytes of name + value', () => {
      expect(codes(draft({ name: 'sz', value: 'A'.repeat(4094) }))).not.toContain('too-large');
    });

    it('rejects 4097 bytes', () => {
      expect(codes(draft({ name: 'sz', value: 'A'.repeat(4095) }))).toContain('too-large');
    });

    it('warns when close to the limit', () => {
      const issues = validateCookie(draft({ name: 'sz', value: 'A'.repeat(3900) }), { nowSeconds: NOW });
      expect(issues).toEqual([expect.objectContaining({ code: 'near-limit', severity: 'warning' })]);
    });

    it('counts UTF-8 bytes, not characters', () => {
      expect(byteLength('日本')).toBe(6);
      expect(cookieSize('a', 'é')).toBe(3);
      expect(codes(draft({ name: 'sz', value: '日'.repeat(1400) }))).toContain('too-large');
    });
  });

  describe('domain and path', () => {
    it('requires a domain', () => {
      expect(codes(draft({ domain: '  ' }))).toEqual(['required']);
    });

    it('rejects a URL in the domain field', () => {
      expect(codes(draft({ domain: 'https://example.com' }))).toContain('domain-format');
      expect(codes(draft({ domain: 'example.com:8080' }))).toContain('domain-format');
      expect(codes(draft({ domain: 'example.com/path' }))).toContain('domain-format');
    });

    it('accepts a leading-dot domain', () => {
      expect(codes(draft({ domain: '.example.com', hostOnly: false }))).toEqual([]);
    });

    it('requires the path to start with /', () => {
      expect(codes(draft({ path: 'api' }))).toContain('path-format');
    });

    it('rejects attributes over 1024 bytes', () => {
      expect(codes(draft({ path: '/' + 'a'.repeat(1024) }))).toContain('path-length');
    });
  });

  describe('flags', () => {
    it('requires Secure for SameSite=None', () => {
      expect(codes(draft({ sameSite: 'no_restriction' }))).toEqual(['samesite-none-insecure']);
      expect(codes(draft({ sameSite: 'no_restriction', secure: true }))).toEqual([]);
    });

    it('requires Secure for a partitioned cookie', () => {
      expect(codes(draft({ partitioned: true }))).toEqual(['partitioned-insecure']);
      expect(codes(draft({ partitioned: true, secure: true }))).toEqual([]);
    });
  });

  describe('prefixes', () => {
    it('requires Secure for __Secure-, case-insensitively', () => {
      expect(codes(draft({ name: '__Secure-id' }))).toEqual(['secure-prefix']);
      expect(codes(draft({ name: '__secure-id' }))).toEqual(['secure-prefix']);
      expect(codes(draft({ name: '__Secure-id', secure: true }))).toEqual([]);
    });

    it('requires Secure, Path=/ and host-only for __Host-', () => {
      expect(codes(draft({ name: '__Host-id', path: '/app', hostOnly: false }))).toEqual([
        'host-prefix-secure', 'host-prefix-path', 'host-prefix-domain',
      ]);
      expect(codes(draft({ name: '__host-id', secure: true }))).toEqual([]);
    });
  });

  describe('expiry', () => {
    it('ignores the expiry of a session cookie', () => {
      expect(codes(draft({ session: true, expirationDate: NOW - DAY }))).toEqual([]);
    });

    it('requires an expiry for a persistent cookie', () => {
      expect(codes(draft({ session: false, expirationDate: null }))).toEqual(['expiry-missing']);
    });

    it('asks for confirmation when the expiry is in the past', () => {
      const issues = validateCookie(draft({ session: false, expirationDate: NOW - 1 }), { nowSeconds: NOW });
      expect(issues).toEqual([expect.objectContaining({ field: 'expires', severity: 'confirm', code: 'expiry-past' })]);
      expect(hasErrors(issues)).toBe(false);
      expect(needsConfirmation(issues)).toBe(true);
    });

    it('warns that expiries beyond 400 days are shortened', () => {
      expect(codes(draft({ session: false, expirationDate: NOW + 401 * DAY }))).toEqual(['expiry-capped']);
      expect(codes(draft({ session: false, expirationDate: NOW + 399 * DAY }))).toEqual([]);
    });
  });
});

describe('hasErrors / needsConfirmation', () => {
  it('distinguishes errors, warnings and confirmations', () => {
    expect(hasErrors([{ field: 'name', severity: 'warning', code: 'x', message: '' }])).toBe(false);
    expect(hasErrors([{ field: 'name', severity: 'error', code: 'x', message: '' }])).toBe(true);
    expect(needsConfirmation([{ field: 'expires', severity: 'warning', code: 'x', message: '' }])).toBe(false);
  });
});
