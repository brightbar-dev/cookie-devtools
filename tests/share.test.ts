import { describe, it, expect } from 'vitest';
import {
  encryptShare, decryptShare, parseShare, serializeShare, looksEncrypted, passwordProblem, ShareError,
  SHARE_FORMAT, SHARE_VERSION, PBKDF2_ITERATIONS, MIN_ITERATIONS, MAX_ITERATIONS, toBase64,
} from '../utils/share';
import type { EncryptedShare } from '../utils/share';
import { formatExport, encryptedFilename } from '../utils/export';
import { planImport } from '../utils/importer';
import type { CookieLike } from '../utils/cookies';

const FAST = { iterations: MIN_ITERATIONS };
const PASSWORD = 'correct horse battery';
const cookies: CookieLike[] = [
  { name: 'sid', value: 'abc123', domain: 'app.example.com', hostOnly: true, path: '/', secure: true, httpOnly: true, sameSite: 'lax', session: false, expirationDate: 4102444800 },
  { name: 'pref', value: 'dark ✓', domain: '.example.com', hostOnly: false, path: '/', secure: false, httpOnly: false, sameSite: 'unspecified', session: true },
];
const plaintext = formatExport('json', cookies);

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return e instanceof ShareError ? e.code : `other:${String(e)}`;
  }
  return undefined;
}

describe('round trip', () => {
  it('decrypts what it encrypted, byte for byte', async () => {
    const file = await encryptShare(plaintext, PASSWORD, FAST);
    expect(await decryptShare(parseShare(serializeShare(file))!, PASSWORD)).toBe(plaintext);
  });

  it('survives the import path: decrypted text plans the same cookies the plain export would', async () => {
    const file = await encryptShare(plaintext, PASSWORD, FAST);
    const text = await decryptShare(file, PASSWORD);
    const plan = planImport(text, { url: 'https://app.example.com/', nowSeconds: 1_700_000_000 });
    expect(plan.error).toBeUndefined();
    expect(plan.cookies.map((c) => [c.name, c.value, c.domain])).toEqual([
      ['sid', 'abc123', 'app.example.com'],
      ['pref', 'dark ✓', '.example.com'],
    ]);
  });

  it('handles an empty list and a large payload', async () => {
    expect(await decryptShare(await encryptShare('[]', PASSWORD, FAST), PASSWORD)).toBe('[]');
    const big = 'x'.repeat(300_000);
    expect(await decryptShare(await encryptShare(big, PASSWORD, FAST), PASSWORD)).toBe(big);
  });

  it('treats equivalent Unicode forms of a password as the same', async () => {
    const file = await encryptShare(plaintext, 'pässwörd-é1', FAST); // composed
    expect(await decryptShare(file, 'pässwörd-é1')).toBe(plaintext); // decomposed
  });

  it('uses a fresh salt and IV every time, and never writes the plaintext', async () => {
    const a = await encryptShare(plaintext, PASSWORD, FAST);
    const b = await encryptShare(plaintext, PASSWORD, FAST);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    const text = serializeShare(a);
    expect(text).not.toContain('abc123');
    expect(text).not.toContain('app.example.com');
  });
});

describe('format', () => {
  it('is versioned and self-describing', async () => {
    const file = await encryptShare(plaintext, PASSWORD, FAST);
    expect(file.format).toBe(SHARE_FORMAT);
    expect(file.version).toBe(SHARE_VERSION);
    expect(file.kdf).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256', iterations: MIN_ITERATIONS });
    expect(file.cipher.name).toBe('AES-256-GCM');
    expect(JSON.parse(serializeShare(file))).toEqual(file);
  });

  it('defaults to a high iteration count', () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });

  it('refuses to write below the iteration floor', async () => {
    await expect(encryptShare(plaintext, PASSWORD, { iterations: MIN_ITERATIONS - 1 })).rejects.toThrow(RangeError);
  });

  it('names the file after the site and day', () => {
    expect(encryptedFilename('app.example.com', new Date('2026-10-07T12:00:00Z'))).toBe('cookies-app.example.com-2026-10-07.cookies.enc.json');
    expect(encryptedFilename('', new Date('2026-10-07T12:00:00Z'))).toBe('cookies-all-sites-2026-10-07.cookies.enc.json');
  });
});

describe('versioning', () => {
  it('reports a newer version with its number instead of guessing', async () => {
    const file = await encryptShare(plaintext, PASSWORD, FAST);
    const newer = JSON.stringify({ ...file, version: SHARE_VERSION + 1 });
    try {
      parseShare(newer);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ShareError);
      expect((e as ShareError).code).toBe('unsupported-version');
      expect((e as ShareError).version).toBe(SHARE_VERSION + 1);
    }
    expect(looksEncrypted(newer)).toBe(true);
  });

  it('rejects a missing, zero, fractional or non-numeric version as damaged', async () => {
    const file = await encryptShare(plaintext, PASSWORD, FAST);
    for (const version of [undefined, 0, -1, 1.5, '1', null]) {
      expect(() => parseShare(JSON.stringify({ ...file, version }))).toThrow(ShareError);
    }
  });

  it('is not triggered by other JSON or text', () => {
    expect(parseShare(plaintext)).toBeNull();
    expect(parseShare('{"format":"other"}')).toBeNull();
    expect(parseShare('{ not json')).toBeNull();
    expect(parseShare('a=1; b=2')).toBeNull();
    expect(looksEncrypted(plaintext)).toBe(false);
  });
});

describe('wrong password', () => {
  it('fails with wrong-password and returns nothing', async () => {
    const file = await encryptShare(plaintext, PASSWORD, FAST);
    expect(await codeOf(decryptShare(file, 'correct horse battery!'))).toBe('wrong-password');
    expect(await codeOf(decryptShare(file, PASSWORD.toUpperCase()))).toBe('wrong-password');
  });

  it('asks for a password rather than trying an empty one', async () => {
    const file = await encryptShare(plaintext, PASSWORD, FAST);
    expect(await codeOf(decryptShare(file, ''))).toBe('password-empty');
  });

  it('rejects weak passwords when writing', async () => {
    expect(passwordProblem('')).toBe('password-empty');
    expect(passwordProblem('short')).toBe('password-short');
    expect(passwordProblem('12345678')).toBeNull();
    expect(await codeOf(encryptShare(plaintext, '', FAST))).toBe('password-empty');
    expect(await codeOf(encryptShare(plaintext, 'seven77', FAST))).toBe('password-short');
  });
});

describe('tampering', () => {
  async function made() {
    return JSON.parse(serializeShare(await encryptShare(plaintext, PASSWORD, FAST))) as EncryptedShare;
  }
  const flip = (b64: string, index = 0) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    bytes[index] = bytes[index]! ^ 1;
    return toBase64(bytes);
  };

  it('fails authentication when any ciphertext byte changes', async () => {
    const file = await made();
    for (const index of [0, 5, Math.floor(atob(file.ciphertext).length / 2), atob(file.ciphertext).length - 1]) {
      const bad = parseShare(JSON.stringify({ ...file, ciphertext: flip(file.ciphertext, index) }))!;
      expect(await codeOf(decryptShare(bad, PASSWORD))).toBe('wrong-password');
    }
  });

  it('fails when the IV or salt changes', async () => {
    const file = await made();
    const iv = parseShare(JSON.stringify({ ...file, cipher: { ...file.cipher, iv: flip(file.cipher.iv) } }))!;
    const salt = parseShare(JSON.stringify({ ...file, kdf: { ...file.kdf, salt: flip(file.kdf.salt) } }))!;
    expect(await codeOf(decryptShare(iv, PASSWORD))).toBe('wrong-password');
    expect(await codeOf(decryptShare(salt, PASSWORD))).toBe('wrong-password');
  });

  it('fails when the iteration count is edited', async () => {
    const file = await made();
    const bad = parseShare(JSON.stringify({ ...file, kdf: { ...file.kdf, iterations: file.kdf.iterations + 1 } }))!;
    expect(await codeOf(decryptShare(bad, PASSWORD))).toBe('wrong-password');
  });

  it('fails when the ciphertext is truncated or extended', async () => {
    const file = await made();
    const bytes = Uint8Array.from(atob(file.ciphertext), (c) => c.charCodeAt(0));
    const short = parseShare(JSON.stringify({ ...file, ciphertext: toBase64(bytes.subarray(0, bytes.length - 1)) }))!;
    const long = parseShare(JSON.stringify({ ...file, ciphertext: toBase64(new Uint8Array([...bytes, 0])) }))!;
    expect(await codeOf(decryptShare(short, PASSWORD))).toBe('wrong-password');
    expect(await codeOf(decryptShare(long, PASSWORD))).toBe('wrong-password');
  });

  it('rejects structurally broken files before any key derivation', async () => {
    const file = await made();
    const cases: Record<string, unknown> = {
      noKdf: { ...file, kdf: undefined },
      algorithm: { ...file, cipher: { ...file.cipher, name: 'AES-128-CBC' } },
      hash: { ...file, kdf: { ...file.kdf, hash: 'SHA-1' } },
      lowIterations: { ...file, kdf: { ...file.kdf, iterations: 1 } },
      hugeIterations: { ...file, kdf: { ...file.kdf, iterations: MAX_ITERATIONS + 1 } },
      saltLength: { ...file, kdf: { ...file.kdf, salt: toBase64(new Uint8Array(4)) } },
      ivLength: { ...file, cipher: { ...file.cipher, iv: toBase64(new Uint8Array(4)) } },
      notBase64: { ...file, ciphertext: '***' },
      tooShort: { ...file, ciphertext: toBase64(new Uint8Array(8)) },
      missingCiphertext: { ...file, ciphertext: undefined },
    };
    for (const [name, bad] of Object.entries(cases)) {
      expect(() => parseShare(JSON.stringify(bad)), name).toThrow(ShareError);
    }
  });
});
