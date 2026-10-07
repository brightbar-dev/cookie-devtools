// Password-encrypted cookie files, for handing a session to someone else.
//
// Format (version 1) is one JSON object, readable without the password so a reader knows what it is:
//   { format, version, kdf: { name, hash, iterations, salt }, cipher: { name, iv }, ciphertext }
// The key is PBKDF2-SHA256 over the password (NFKC-normalised) and a random 16-byte salt; the cipher is
// AES-256-GCM with a random 12-byte IV. Everything above the ciphertext is bound into the GCM tag as
// additional data, so changing the iteration count, salt, IV or version fails authentication instead of
// quietly deriving some other key. The plaintext is the same JSON the plain JSON export writes.
//
// WebCrypto only; nothing here touches the browser's cookie or storage APIs.

export const SHARE_FORMAT = 'cookie-devtools-encrypted';
export const SHARE_VERSION = 1;
/** OWASP's 2023 figure for PBKDF2-HMAC-SHA256. */
export const PBKDF2_ITERATIONS = 600_000;
/** What a reader accepts: below the floor the file protects too little, above the ceiling a hostile file could stall the page. */
export const MIN_ITERATIONS = 100_000;
export const MAX_ITERATIONS = 5_000_000;
export const MIN_PASSWORD_LENGTH = 8;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface EncryptedShare {
  format: typeof SHARE_FORMAT;
  version: number;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-256-GCM'; iv: string };
  ciphertext: string;
}

export type ShareErrorCode =
  | 'password-empty'
  | 'password-short'
  | 'not-encrypted'
  | 'unsupported-version'
  | 'malformed'
  | 'wrong-password';

/** A failure the UI turns into a message; `version` is set for `unsupported-version`. */
export class ShareError extends Error {
  constructor(readonly code: ShareErrorCode, readonly version?: number) {
    super(code);
    this.name = 'ShareError';
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  if (typeof text !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) throw new ShareError('malformed');
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function passwordBytes(password: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(password.normalize('NFKC'));
}

/** Returns the code a password is rejected with when writing a file, or null if it is acceptable. */
export function passwordProblem(password: string): ShareErrorCode | null {
  if (!password) return 'password-empty';
  if ([...password].length < MIN_PASSWORD_LENGTH) return 'password-short';
  return null;
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', passwordBytes(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** The bytes GCM authenticates alongside the ciphertext: every field of the header, in fixed order. */
function associatedData(file: Pick<EncryptedShare, 'format' | 'version' | 'kdf' | 'cipher'>): Uint8Array<ArrayBuffer> {
  const { kdf, cipher } = file;
  return encoder.encode([file.format, file.version, kdf.name, kdf.hash, kdf.iterations, kdf.salt, cipher.name, cipher.iv].join('|'));
}

export interface EncryptOptions {
  /** Only for tests, which cannot afford the default; never below MIN_ITERATIONS. */
  iterations?: number;
}

export async function encryptShare(plaintext: string, password: string, options: EncryptOptions = {}): Promise<EncryptedShare> {
  const problem = passwordProblem(password);
  if (problem) throw new ShareError(problem);
  const iterations = options.iterations ?? PBKDF2_ITERATIONS;
  if (iterations < MIN_ITERATIONS) throw new RangeError('iterations below the minimum');

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const header = {
    format: SHARE_FORMAT as typeof SHARE_FORMAT,
    version: SHARE_VERSION,
    kdf: { name: 'PBKDF2' as const, hash: 'SHA-256' as const, iterations, salt: toBase64(salt) },
    cipher: { name: 'AES-256-GCM' as const, iv: toBase64(iv) },
  };
  const key = await deriveKey(password, salt, iterations);
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: associatedData(header), tagLength: TAG_BYTES * 8 },
    key,
    encoder.encode(plaintext),
  );
  return { ...header, ciphertext: toBase64(new Uint8Array(sealed)) };
}

export function serializeShare(file: EncryptedShare): string {
  return JSON.stringify(file, null, 2);
}

/**
 * Reads the envelope without needing the password. Returns null when the text is not one of ours at all
 * (so callers can fall through to the other import formats); throws a ShareError for one that is ours but
 * cannot be used (a newer version, or damaged).
 */
export function parseShare(text: string): EncryptedShare | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || (raw as Record<string, unknown>).format !== SHARE_FORMAT) return null;
  const o = raw as Record<string, unknown>;

  if (typeof o.version !== 'number' || !Number.isInteger(o.version) || o.version < 1) throw new ShareError('malformed');
  if (o.version > SHARE_VERSION) throw new ShareError('unsupported-version', o.version);

  const kdf = o.kdf as Record<string, unknown> | undefined;
  const cipher = o.cipher as Record<string, unknown> | undefined;
  if (!kdf || typeof kdf !== 'object' || !cipher || typeof cipher !== 'object') throw new ShareError('malformed');
  if (kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' || cipher.name !== 'AES-256-GCM') throw new ShareError('malformed');
  const { iterations, salt } = kdf;
  if (typeof iterations !== 'number' || !Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new ShareError('malformed');
  }
  if (typeof salt !== 'string' || fromBase64(salt).length !== SALT_BYTES) throw new ShareError('malformed');
  if (typeof cipher.iv !== 'string' || fromBase64(cipher.iv).length !== IV_BYTES) throw new ShareError('malformed');
  if (typeof o.ciphertext !== 'string' || fromBase64(o.ciphertext).length < TAG_BYTES) throw new ShareError('malformed');

  return {
    format: SHARE_FORMAT as typeof SHARE_FORMAT,
    version: o.version,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt },
    cipher: { name: 'AES-256-GCM', iv: cipher.iv },
    ciphertext: o.ciphertext,
  };
}

/** True when the text is one of our encrypted files (even a damaged or newer one). */
export function looksEncrypted(text: string): boolean {
  try {
    return parseShare(text) !== null;
  } catch {
    return true;
  }
}

/**
 * Decrypts and authenticates. A wrong password and a changed file are indistinguishable to AES-GCM, so both
 * throw `wrong-password`; nothing is returned unless the tag verified.
 */
export async function decryptShare(file: EncryptedShare, password: string): Promise<string> {
  if (!password) throw new ShareError('password-empty');
  const key = await deriveKey(password, fromBase64(file.kdf.salt), file.kdf.iterations);
  let opened: ArrayBuffer;
  try {
    opened = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(file.cipher.iv), additionalData: associatedData(file), tagLength: TAG_BYTES * 8 },
      key,
      fromBase64(file.ciphertext),
    );
  } catch {
    throw new ShareError('wrong-password');
  }
  try {
    return decoder.decode(opened);
  } catch {
    throw new ShareError('malformed');
  }
}
