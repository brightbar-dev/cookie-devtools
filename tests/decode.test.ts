import { describe, it, expect } from 'vitest';
import { decodeValue, decodeJwt, decodeBase64, formatRelative } from '../utils/decode';

const NOW = 1_800_000_000;
const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const b64url = (text: string) => b64(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64u = (o: unknown) => b64url(JSON.stringify(o));
const jwt = (payload: unknown, header: unknown = { alg: 'HS256', typ: 'JWT' }, sig = 'c2lnbmF0dXJl') => `${b64u(header)}.${b64u(payload)}.${sig}`;

describe('formatRelative', () => {
  it('describes future and past times in the largest whole unit', () => {
    expect(formatRelative(NOW + 3 * 86400, NOW)).toBe('in 3 days');
    expect(formatRelative(NOW - 2 * 3600, NOW)).toBe('2 hours ago');
    expect(formatRelative(NOW + 90, NOW)).toBe('in 2 minutes');
    expect(formatRelative(NOW + 400 * 86400, NOW)).toBe('next year');
    expect(formatRelative(NOW, NOW)).toBe('now');
  });

  it('carries rounding into the next unit', () => {
    expect(formatRelative(NOW + 3599, NOW)).toBe('in 1 hour');
    expect(formatRelative(NOW - 86399, NOW)).toBe('yesterday');
    expect(formatRelative(NOW + 35 * 86400, NOW)).toBe('next month');
  });
});

describe('decodeJwt', () => {
  it('decodes header and payload and dates the time claims', () => {
    const view = decodeJwt(jwt({ sub: 'u1', iat: NOW - 60, exp: NOW + 3600, nbf: NOW - 60 }), NOW)!;
    expect(view.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(view.payload).toEqual({ sub: 'u1', iat: NOW - 60, exp: NOW + 3600, nbf: NOW - 60 });
    expect(view.hasSignature).toBe(true);
    expect(view.expired).toBe(false);
    expect(view.notYetValid).toBe(false);
    const exp = view.times.find((t) => t.claim === 'exp')!;
    expect(exp.iso).toBe(new Date((NOW + 3600) * 1000).toISOString());
    expect(exp.relative).toBe('in 1 hour');
    expect(view.times.map((t) => t.claim)).toEqual(['exp', 'nbf', 'iat']);
  });

  it('flags expired and not-yet-valid tokens', () => {
    expect(decodeJwt(jwt({ exp: NOW - 1 }), NOW)!.expired).toBe(true);
    expect(decodeJwt(jwt({ nbf: NOW + 100 }), NOW)!.notYetValid).toBe(true);
  });

  it('accepts an unsigned token', () => {
    const view = decodeJwt(`${b64u({ alg: 'none' })}.${b64u({ a: 1 })}.`, NOW)!;
    expect(view.hasSignature).toBe(false);
  });

  it('rejects dotted values that are not JWTs', () => {
    expect(decodeJwt('a.b.c', NOW)).toBeNull();
    expect(decodeJwt('www.example.com', NOW)).toBeNull();
    expect(decodeJwt(`${b64u({ typ: 'JWT' })}.${b64u({ a: 1 })}.x`, NOW)).toBeNull(); // header without alg
  });
});

describe('decodeBase64', () => {
  it('decodes Base64 and Base64URL text', () => {
    expect(decodeBase64(b64('hello, cookie world'))).toEqual({ variant: 'Base64', text: 'hello, cookie world' });
    const url = b64url('ÿþ subjects?');
    expect(decodeBase64(url)?.text).toBe('ÿþ subjects?');
  });

  it('ignores short values, hex, plain words and binary data', () => {
    expect(decodeBase64('abc=')).toBeNull();
    expect(decodeBase64('deadbeefcafebabe')).toBeNull();
    expect(decodeBase64('sessionidentifier')).toBeNull();
    expect(decodeBase64(btoa(String.fromCharCode(0x00, 0xff, 0x10, 0x80, 0x01, 0x02, 0x03, 0x04)))).toBeNull();
  });
});

describe('decodeValue', () => {
  it('shows URL-decoded text and pretty JSON for an encoded JSON value', () => {
    const value = encodeURIComponent(JSON.stringify({ theme: 'dark', flags: ['a'] }));
    const views = decodeValue(value, NOW);
    expect(views.url).toBe('{"theme":"dark","flags":["a"]}');
    expect(views.json).toBe(JSON.stringify({ theme: 'dark', flags: ['a'] }, null, 2));
  });

  it('pretty-prints a raw JSON value', () => {
    expect(decodeValue('{"a":1}', NOW)).toEqual({ json: '{\n  "a": 1\n}' });
  });

  it('decodes a JWT value, including a URL-encoded one', () => {
    const token = jwt({ sub: 'x', exp: NOW + 10 });
    expect(decodeValue(token, NOW).jwt?.payload).toEqual({ sub: 'x', exp: NOW + 10 });
    expect(decodeValue(encodeURIComponent(token).replace(/\./g, '%2E'), NOW).jwt).toBeDefined();
  });

  it('decodes Base64 JSON to both views', () => {
    const views = decodeValue(b64('{"user":42}'), NOW);
    expect(views.base64?.text).toBe('{"user":42}');
    expect(views.json).toBe('{\n  "user": 42\n}');
  });

  it('offers nothing for ordinary values', () => {
    expect(decodeValue('strict-val', NOW)).toEqual({});
    expect(decodeValue('sid-1789445027556', NOW)).toEqual({});
    expect(decodeValue('100%', NOW)).toEqual({});
  });

  it('survives malformed percent escapes', () => {
    expect(decodeValue('%E0%A4%A', NOW).url).toBeUndefined();
  });
});
