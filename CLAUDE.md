# Cookie DevTools — Browser Extension

## What This Is
Developer-focused cookie manager with real-time monitoring, environment profiles, and export to curl/wget. Targets the ~1M+ users displaced by EditThisCookie's removal plus developers who need more than basic cookie editing.

Built with [WXT](https://wxt.dev/) — builds for Chrome (MV3) and Firefox (MV2) from one codebase.

## Architecture
- **entrypoints/background.ts** — Service worker. Cookie CRUD via `browser.cookies` API, change monitoring via `browser.cookies.onChanged`, profile management, import writes. All cookie reads and writes go through here.
- **entrypoints/popup/**, **entrypoints/sidepanel/**, **entrypoints/devtools-panel/** — thin surfaces that each call `mountApp` from `ui/app.ts` and differ only in how they find the page: the popup reads the active tab (or `?url=` when opened as a full tab, used for file import); the side panel follows the active tab via `tabs.onActivated`/`onUpdated`; the DevTools panel follows `devtools.inspectedWindow.tabId` via `tabs.get`, `devtools.network.onNavigated` and `tabs.onUpdated`. **entrypoints/devtools/** only registers that panel (`devtools.panels.create`). Both DevTools entrypoints carry `manifest.exclude: ['firefox']`: Firefox DevTools pages get no cookies or tabs API.
- **entrypoints/options/** — Options page for theme, max log entries, data clearing.
- **utils/cookies.ts** — Export formats, escaping, filtering, badges, cookie URL construction, datetime-local conversion.
- **utils/writes.ts** — What to pass `cookies.set`/`remove` so a cookie keeps its identity (host-only, store, partition), cookie identity, edit/restore planning, partition-site candidates.
- **utils/validate.ts** — Editor validation; each error mirrors a write the browser rejects.
- **utils/monitor.ts** — Monitor settings (opt-in, scope) and `ChangeLogBuffer`, the batched log writer.
- **utils/importer.ts** — `planImport`: detects JSON (ours, Cookie-Editor, EditThisCookie, Playwright), Netscape, Cookie/Set-Cookie headers and curl; normalises, validates, and reports what will be created or skipped and why. Writes nothing.
- **utils/decode.ts** — Value inspector decoding: URL, Base64/Base64URL, JSON, JWT (decode only, never verify).
- **utils/list.ts** — Sorting, filter chips, compact expiry, size totals. **utils/export.ts** — export text and filenames. **utils/messages.ts** — reply types shared by background and pages.
- **ui/** — the shared UI: `app.ts` (tabs: Cookies, Monitor, Profiles; list with sort, chips, selection and sizes; editor with Protect/Block; import, rules and confirmation `<dialog>`s; undo toasts; export menu; live change feed), `markup.ts`, `app.css`, plus `dom.ts` (toast, confirm, copy, download), `inspector.ts`, `import-dialog.ts`.
- **utils/rules.ts** — Protect/Block rules, `decideRuleAction` and `WriteGuard`. **utils/target.ts** — which page a surface works on.
- **utils/i18n.ts** — `t(key, ...substitutions)` and `tp(key, count, ...)` (a `_one`/`_other` pair) over `browser.i18n`; keys are typed from `public/_locales/en/messages.json`. `ui/dom.ts` `localize(root)` fills `data-i18n`, `data-i18n-title`, `data-i18n-aria-label` and `data-i18n-placeholder`.
- **public/_locales/** — every user-facing string is in `en/messages.json` (Chrome's placeholder format: `$NAME$` in the message, `{"name": {"content": "$1"}}`, count always `$1` in plural pairs). The other 19 locales translate only `appName` and `appDescription`; the rest falls back to English (`default_locale`).
- **public/icon-{16,48,128}.png** — Extension icons.
- **store/** — `cws.json` (listing text, single purpose, permission justifications), `screenshots/` and `promo/` (generated from the real build by `store/tools/`; regenerate them in any PR that changes what they show — see `store/tools/README.md`). `store-assets/` is the superseded v0.2 set.

## Key Implementation Details
- Popup gets domain context from active tab, sends messages to background for all cookie operations. The background answers with `sendResponse` + `return true`, not a returned promise, so it works on every Chrome and Firefox version.
- **Edit is set-then-remove** (`updateCookie`): write the new cookie first; remove the original only if the write succeeded and `shouldRemoveOriginal` says it landed in a different jar entry. Never delete first.
- **Faithful writes**: always build `set`/`remove` details with `toSetDetails`/`toRemoveDetails`. Passing `domain` turns a host-only cookie into a domain cookie; omitting `partitionKey` makes `remove` a silent no-op on a partitioned cookie.
- **Partitioned (CHIPS) cookies**: `getAll({url})` omits them; `getAll({url, partitionKey: {}})` includes this host's in every partition; `getAll({partitionKey: {topLevelSite}})` returns cookies embedded third parties stored under a site. A first-party partitioned cookie's write URL must be same-site with its top-level site (http:// on a loopback dev server) or Chrome throws — `cookieUrl` handles it. Verified live in Chrome for Testing 151, 2026-09-15.
- Monitor uses `browser.cookies.onChanged` with cause tracking (explicit, expired, evicted, overwritten). Recording is **off until the user turns it on** (`monitor` in storage), can be scoped to one site, and entries go through `ChangeLogBuffer` — at most one storage write per second, flushes serialised.
- Delete All confirms with the count; deletes and profile loads return snapshots the popup offers to undo for 10 s.
- **Surfaces never need `tabs`**: reading `tab.url` from `tabs.query` and `tabs.onUpdated` is covered by the `<all_urls>` host permission. The side panel adds only `sidePanel`. Feature-detect `sidePanel`/`sidebarAction` — Firefox gets a `sidebar_action` from the same entrypoint.
- **Install warnings — measure, never assume.** Chrome's install prompt shows one line, "Read and change all your data on all websites", from `<all_urls>`; reading and writing cookies on any site needs it. Measure with `chrome.management.getPermissionWarningsByManifest(JSON.stringify(manifest), cb)`, called from any extension page (no `management` permission needed), on the manifest before and after any change. Never use `developerPrivate.getExtensionsInfo().permissions.simplePermissions`: it omits host-permission warnings, and trusting it put a false "no install warnings" claim on the listing (corrected 2026-09-15). Measured 2026-09-15 in Chrome for Testing 151: beside `<all_urls>`, `tabs`, `sidePanel` and `devtools_page` add no line and `clipboardWrite` adds "Modify data you copy and paste"; with no host permissions the prompt is empty, and `tabs` there adds "Read your browsing history". `scripts/check-manifest.mjs` is the CI allowlist guard that stops the permission set growing and keeps `content_scripts` out (the listing says the extension never injects scripts).
- **Protect / Block** (`rules` in storage): the background enforces them in its `cookies.onChanged` listener. Protect restores the saved state when a site changes or deletes the cookie (it ignores the `overwrite` removal and judges the new value's event); Block removes a named cookie whenever it is set. Every extension write first calls `guard.expect(identity)` so enforcement ignores its own events; restores are capped per cookie (`allowRestore`) and re-checked when the quiet window ends so a page write inside it cannot stick. A user's own edit or import of a protected cookie moves the lock; deleting it on purpose ends the protection.
- **Keyboard**: `/` focuses search (↓ from search enters the list); in the list ↑/↓/Home/End move a single tab stop, Enter opens the editor, Space selects, Delete/Backspace deletes with undo; ←/→ switch tabs; closing the editor returns focus to its row.
- The UI listens to `cookies.onChanged` itself for the page it shows: the list refreshes, and the Monitor's **Live** view lists changes in memory only — nothing is stored unless Record is on.
- **Import** never writes before the preview: `planImport` → the dialog shows created / replaced / skipped-with-reason → `importCookies` (the same `writeCookies` path as undo and profiles). Imported cookies drop `storeId` so they land in the current store.
- **Export** is formatted in the page from the cookies the list holds: the selection if any, otherwise what the filters show. Download is an anchor `download` of a blob — no `downloads` permission. Netscape marks HttpOnly with `#HttpOnly_`; curl single-quotes safely. Every re-importable format has a round-trip test in `tests/importer.test.ts`.
- Profiles stored in `browser.storage.local` as named cookie snapshots; restore skips cookies that have expired since and reports them.
- Export formats: JSON, Netscape cookie file, curl command, raw Cookie header — copy or download
- Theme toggle with auto-detect via `prefers-color-scheme`
- Uses `browser.*` API (WXT polyfill) for cross-browser compatibility
- **No English in code or markup**: new UI text goes into `public/_locales/en/messages.json` and is read with `t()`/`tp()` or a `data-i18n*` attribute. Messages hold no HTML; escape `t()` output with `escapeHtml` in `innerHTML` templates (substitutions carry cookie names and domains). Don't call `t()` at module load. `tests/i18n.test.ts` enforces it.

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
- `tests/rules.test.ts`: when Protect restores and Block removes, and the event-precise write guard and restore cap; `tests/target.test.ts`: which pages have cookies, how the empty state explains the rest, and which tab updates move a surface to a new page
- `tests/i18n.test.ts`: every `t()`/`tp()`/`data-i18n` key exists and every message is used; placeholders and plural pairs are well formed; `formatMessage` fills messages as Chrome does (`tests/setup-i18n.ts` serves the English file to every test through it, since Node has no `browser.i18n`); markup, HTML pages and UI code carry no literal English
- `tests/manifest.test.ts`: the CI allowlist guard in `scripts/check-manifest.mjs` (permissions, optional permissions, hosts, no `content_scripts`)
- `tests/contrast.test.ts`: reads `ui/app.css` (via `?raw`) and fails if any text/surface token pair, or white on a badge, drops below WCAG AA (4.5:1) in either theme — change colours there, not in component rules

## Conventions
- WXT framework with vanilla TypeScript (no UI framework)
- Version: semver, managed by release-please; the popup and options page read it from the manifest
- Requires `cookies`, `storage`, `activeTab` and `sidePanel` permissions and `<all_urls>` host permission. Chrome's install prompt shows one warning for that set, "Read and change all your data on all websites" (measured with `getPermissionWarningsByManifest` — see Key Implementation Details); `scripts/check-manifest.mjs` in CI fails if the set grows. `tabs` deliberately dropped 2026-08-26 — see `wxt.config.ts`
- Do NOT add Claude/AI as co-author or contributor
