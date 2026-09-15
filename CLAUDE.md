# Cookie DevTools — Browser Extension

## What This Is
Developer-focused cookie manager with real-time monitoring, environment profiles, and export to curl/wget. Targets the ~1M+ users displaced by EditThisCookie's removal plus developers who need more than basic cookie editing.

Built with [WXT](https://wxt.dev/) — builds for Chrome (MV3) and Firefox (MV2) from one codebase.

## Architecture
- **entrypoints/background.ts** — Service worker. Cookie CRUD via `browser.cookies` API, change monitoring via `browser.cookies.onChanged`, profile management, import writes. All cookie reads and writes go through here.
- **entrypoints/popup/** — Browser action popup with tabbed UI (Cookies, Monitor, Profiles): list with sort, filter chips, selection and sizes; editor, import and confirmation `<dialog>`s; undo toasts; export menu (copy or download); dark/light theme. Opened as `popup.html?url=<page>` it runs as a full tab for that page (used for file import, where a file picker could close the popup).
- **entrypoints/options/** — Options page for theme, max log entries, data clearing.
- **utils/cookies.ts** — Export formats, escaping, filtering, badges, cookie URL construction, datetime-local conversion.
- **utils/writes.ts** — What to pass `cookies.set`/`remove` so a cookie keeps its identity (host-only, store, partition), cookie identity, edit/restore planning, partition-site candidates.
- **utils/validate.ts** — Editor validation; each error mirrors a write the browser rejects.
- **utils/monitor.ts** — Monitor settings (opt-in, scope) and `ChangeLogBuffer`, the batched log writer.
- **utils/importer.ts** — `planImport`: detects JSON (ours, Cookie-Editor, EditThisCookie, Playwright), Netscape, Cookie/Set-Cookie headers and curl; normalises, validates, and reports what will be created or skipped and why. Writes nothing.
- **utils/decode.ts** — Value inspector decoding: URL, Base64/Base64URL, JSON, JWT (decode only, never verify).
- **utils/list.ts** — Sorting, filter chips, compact expiry, size totals. **utils/export.ts** — export text and filenames. **utils/messages.ts** — reply types shared by background and pages.
- **ui/** — DOM modules shared by extension pages: `dom.ts` (toast, confirm, copy, download), `inspector.ts`, `import-dialog.ts`.
- **public/icon-{16,48,128}.png** — Extension icons.

## Key Implementation Details
- Popup gets domain context from active tab, sends messages to background for all cookie operations. The background answers with `sendResponse` + `return true`, not a returned promise, so it works on every Chrome and Firefox version.
- **Edit is set-then-remove** (`updateCookie`): write the new cookie first; remove the original only if the write succeeded and `shouldRemoveOriginal` says it landed in a different jar entry. Never delete first.
- **Faithful writes**: always build `set`/`remove` details with `toSetDetails`/`toRemoveDetails`. Passing `domain` turns a host-only cookie into a domain cookie; omitting `partitionKey` makes `remove` a silent no-op on a partitioned cookie.
- **Partitioned (CHIPS) cookies**: `getAll({url})` omits them; `getAll({url, partitionKey: {}})` includes this host's in every partition; `getAll({partitionKey: {topLevelSite}})` returns cookies embedded third parties stored under a site. A first-party partitioned cookie's write URL must be same-site with its top-level site (http:// on a loopback dev server) or Chrome throws — `cookieUrl` handles it. Verified live in Chrome for Testing 151, 2026-09-15.
- Monitor uses `browser.cookies.onChanged` with cause tracking (explicit, expired, evicted, overwritten). Recording is **off until the user turns it on** (`monitor` in storage), can be scoped to one site, and entries go through `ChangeLogBuffer` — at most one storage write per second, flushes serialised.
- Delete All confirms with the count; deletes and profile loads return snapshots the popup offers to undo for 10 s.
- **Import** never writes before the preview: `planImport` → the dialog shows created / replaced / skipped-with-reason → `importCookies` (the same `writeCookies` path as undo and profiles). Imported cookies drop `storeId` so they land in the current store.
- **Export** is formatted in the page from the cookies the list holds: the selection if any, otherwise what the filters show. Download is an anchor `download` of a blob — no `downloads` permission. Netscape marks HttpOnly with `#HttpOnly_`; curl single-quotes safely. Every re-importable format has a round-trip test in `tests/importer.test.ts`.
- Profiles stored in `browser.storage.local` as named cookie snapshots; restore skips cookies that have expired since and reports them.
- Export formats: JSON, Netscape cookie file, curl command, raw Cookie header — copy or download
- Theme toggle with auto-detect via `prefers-color-scheme`
- Uses `browser.*` API (WXT polyfill) for cross-browser compatibility

## Commands
```bash
npm run dev          # Dev mode with HMR (Chrome)
npm run dev:firefox  # Dev mode (Firefox)
npm run build        # Production build (Chrome)
npm run build:firefox # Production build (Firefox)
npm run zip          # Build + zip for store submission
npm run test         # Run Vitest tests
npm run test:watch   # Watch mode
npx tsc --noEmit     # Typecheck (CI runs it; wxt build does not check types)
```

## Testing
```bash
npm test
```
- Unit tests via Vitest + WXT testing plugin, in a Node environment (no DOM) — put logic in `utils/` and test it there
- `tests/cookies.test.ts`: export formats, escaping, cookie URLs (incl. partitioned), datetime-local round trip, filtering, badges
- `tests/writes.test.ts`: set/remove details, identity, when an edit removes the original, restore planning, partition-site candidates
- `tests/validate.test.ts`: every editor rule, with the browser behaviour it mirrors
- `tests/monitor.test.ts`: opt-in settings, site scope, batched and serialised log writes
- `tests/importer.test.ts`: format detection, each parser, skip reasons, and export → import round trips
- `tests/decode.test.ts`, `tests/list.test.ts`, `tests/export.test.ts`: inspector decoding, sort/chips/sizes, export text and filenames

## Conventions
- WXT framework with vanilla TypeScript (no UI framework)
- Version: semver, managed by release-please; the popup and options page read it from the manifest
- Requires `cookies`, `storage`, `activeTab` permissions and `<all_urls>` host permission (`tabs` deliberately dropped 2026-08-26 — see `wxt.config.ts`)
- Do NOT add Claude/AI as co-author or contributor
