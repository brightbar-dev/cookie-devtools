# Cookie DevTools — Browser Extension

## What This Is
Developer-focused cookie manager with real-time monitoring, environment profiles, and export to curl/wget. Targets the ~1M+ users displaced by EditThisCookie's removal plus developers who need more than basic cookie editing.

Built with [WXT](https://wxt.dev/) — builds for Chrome (MV3) and Firefox (MV2) from one codebase.

## Architecture
- **entrypoints/background.ts** — Service worker. Cookie CRUD via `browser.cookies` API, change monitoring via `browser.cookies.onChanged`, profile management, export formatting. All cookie logic lives here.
- **entrypoints/popup/** — Browser action popup with tabbed UI (Cookies, Monitor, Profiles). Cookie editor modal, export dropdown, dark/light theme.
- **entrypoints/options/** — Options page for theme, max log entries, data clearing.
- **utils/cookies.ts** — Shared utility functions (export formats, escaping, filtering, badges, URL construction). Exported for testing.
- **public/icon-{16,48,128}.png** — Extension icons.

## Key Implementation Details
- Popup gets domain context from active tab, sends messages to background for all cookie operations
- Monitor uses `browser.cookies.onChanged` with cause tracking (explicit, expired, evicted, overwritten)
- Profiles stored in `browser.storage.local` as named cookie snapshots
- Export formats: JSON, Netscape cookie file, curl command, raw Cookie header
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
```

## Testing
```bash
npm test
```
- 63 unit tests via Vitest + WXT testing plugin
- Tests cover: export formats, HTML escaping, cookie URL construction, expiry formatting, filtering, badge generation, SameSite labels, cookie data building, cause map, log truncation

## Conventions
- WXT framework with vanilla TypeScript (no UI framework)
- Version: semver, 0.2.x (WXT rewrite)
- Requires `cookies`, `storage`, `activeTab`, `tabs` permissions and `<all_urls>` host permission
- Do NOT add Claude/AI as co-author or contributor
