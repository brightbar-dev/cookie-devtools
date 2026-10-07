# Encrypted cookie export / import

## What was built
- `utils/share.ts` — WebCrypto only. PBKDF2-SHA256 (600,000 iterations, random 16-byte salt) → AES-256-GCM (random 12-byte IV). Versioned, self-describing JSON file (`format`, `version`, `kdf`, `cipher`, `ciphertext`). All header fields are bound into the GCM tag as additional data, so editing the iteration count, salt, IV or version fails authentication. Passwords are NFKC-normalised. Readers accept 100k–5M iterations only (a hostile file can't stall the page). Plaintext is the existing JSON export.
- **Export encrypted** — new row in the Export menu → dialog (`ui/share-dialog.ts`): password + confirm (min 8 chars), show-password toggle, a visible warning that the file grants access to the session and that the password should travel separately. Download (`cookies-<site>-<date>.cookies.enc.json`) or Copy. Covers selection / shown / all, like the other formats. Password fields are cleared when the dialog closes.
- **Import encrypted** — the existing Import dialog detects our file (paste, open or drop), reveals a password field, and decrypts. Only after authentication does it show the usual created/replaced/skipped preview, then applies through the unchanged `planImport` → `importCookies` path. Wrong password / changed file → one clear error, password field focused and marked `aria-invalid`, no preview, nothing written. Newer format version → message naming the version. Damaged file → "damaged or incomplete".
- Strings are in `public/_locales/en/messages.json` (English only); no new permissions, hosts or dependencies; `scripts/check-manifest.mjs` still passes.

## Versus J2TEAM Cookies
I couldn't inspect J2TEAM's implementation from this sandbox, so this compares to what I know of it (password-protected whole-site export/import), not a verified feature list.
- Authenticated encryption with the header bound in; a wrong password or modified file can never produce a partial import.
- Preview of exactly what will be created/replaced/skipped before anything is written; per-cookie result afterwards.
- Selection-aware (export just chosen cookies), copy as well as download, partition keys and HttpOnly preserved.
- Keyboard/a11y: labelled fields, focus moves to the password on open, errors in `role="alert"` regions tied with `aria-describedby`, Enter submits, Esc closes, `aria-busy` while deriving. Uses existing colour tokens (theme-aware; `tests/contrast.test.ts` passes).
- Free, no upsell copy.

## Evidence
- Screenshots: `e2e-evidence/` (export menu, export dialog light/dark, locked import, wrong password, preview).
- E2E (real built extension in Playwright Chromium): `tests/e2e/encrypted-share.e2e.mjs`, 21 checks pass — export validation, download has no plaintext, wrong password imports nothing, correct password previews then restores `sid` (HttpOnly) and `theme`, tampered ciphertext and newer version rejected. The repo has no e2e harness or CI hook for it; it is not run by Vitest.

## Validation
- `pnpm exec tsc --noEmit` — pass
- `pnpm test` — 18 files, 394 tests pass (20 new in `tests/share.test.ts`: round trip, import-path round trip, Unicode normalisation, fresh salt/IV, versioning, wrong password, tampering of ciphertext/IV/salt/iterations/length, malformed headers)
- `pnpm run build` and `pnpm run build:firefox` — pass; `node scripts/check-manifest.mjs .output/chrome-mv3/manifest.json` — within allowlist

## Not done
- `CLAUDE.md` architecture list doesn't mention `utils/share.ts` / `ui/share-dialog.ts` (left alone deliberately).
- Store screenshots/listing text not regenerated (the encrypted export isn't in them); worth a line in `store/cws.json` later.
- Password strength is a length floor only (no meter).
- `REPORT.md` and `e2e-evidence/` are for harvesting; remove before merge.
