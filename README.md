# Cookie DevTools

Cookie editor and cookie manager for developers: edit safely, import from other tools with a preview, decode JWT/Base64/JSON values, protect and block cookies, watch changes live, and export to JSON, cookies.txt, curl or a Cookie header — in the popup or Chrome's side panel. No ads, no tracking, no install warnings.

## Features

### Cookie Management
- View all cookies for the current site with search/filter, including partitioned (CHIPS) cookies — first-party and those set by embedded cross-site frames
- Add, edit, and delete cookies
- Safe edits: the new cookie is written before the old one is removed, so a change the browser rejects never destroys the original; the error shows in the editor
- Faithful edits: host-only, partition, cookie store and exact expiry are kept unless you change them
- Validation before you save: SameSite=None and partitioned cookies need Secure, `__Secure-`/`__Host-` prefix rules, forbidden characters, the 4096-byte size limit, 400-day expiry cap, and a confirmation when an expiry in the past would delete the cookie
- Delete All asks first, with the count, and both single deletes and Delete All can be undone for 10 seconds
- Visual attribute badges: Secure, HttpOnly, SameSite, Session, Partitioned
- Sort by name, domain, expiry or size; filter chips for Secure, HttpOnly, Session, Partitioned and SameSite=None
- Each row shows when the cookie expires ("3d", "Session") and its size; the list totals the site's cookie bytes and flags cookies near the 4096-byte limit
- Select cookies to delete or export just those
- One-click copy cookie values

### Value Inspector
- Beside the raw value in the editor: URL-decoded, Base64/Base64URL-decoded and pretty-printed JSON views, each with a copy button
- JWTs: header and payload as JSON, `exp`/`iat`/`nbf` as dates with "expires in 1 hour" or "expired" — decoded only, the signature is never verified

### Import
- Paste, open or drop: JSON from Cookie DevTools, Cookie-Editor, EditThisCookie or Playwright/Puppeteer; Netscape `cookies.txt`; a `Cookie:` header (applied to the current site); `Set-Cookie:` headers; or a curl command
- A preview before anything is written: how many will be created, how many replace existing cookies, and each skipped entry with the reason (already expired, SameSite=None without Secure, and so on)
- A per-cookie result after import

### Popup and Side Panel
- The same cookie tools in the toolbar popup and in Chrome's side panel, which stays open and follows the tab you're viewing ("Open in side panel" from the popup)
- The list refreshes as the site changes cookies; the Monitor's **Live** view shows those changes as they happen without saving anything

### Protect and Block
- **Protect** a cookie from its editor: when a site changes or deletes it, the saved value is put back. Your own edits move the lock; deleting it on purpose ends the protection
- **Block** a cookie: it is deleted now and whenever a site sets it again — undo or unblock any time
- Protected cookies carry a Lock badge; each site shows its rules, and Settings lists them all

### Change Monitor
- Opt-in: nothing is recorded until you switch Record on
- Record every site, or only the site you choose
- Shows cause: explicit, expired, evicted, overwritten, with value and timestamp
- The log stays in local extension storage, capped at the size set in Settings, and can be cleared from the Monitor tab

### Environment Profiles
- Save cookie snapshots as named profiles (e.g., "dev-local", "staging-admin")
- One-click profile loading that replaces the site's cookies, reports what was restored, skips cookies that expired since the snapshot, and can be undone
- Switch between environments instantly

### Developer Export
- Copy to the clipboard or download as a file — for the selected cookies, the filtered list, or the whole site
- **JSON**: Full cookie data with all attributes (re-importable)
- **Cookie File**: curl/wget-compatible cookie file format, with HttpOnly marked (re-importable)
- **curl command**: Ready-to-paste curl with -b flag, safely quoted (re-importable)
- **Cookie header**: Raw header string for HTTP requests (re-importable)

### Other
- Dark mode (auto-detects system preference); colours meet WCAG AA in both themes, checked by a test
- Keyboard: `/` to search, arrow keys through the list, Enter to edit, Space to select, Delete to delete (with undo)
- No ads, no tracking, no data collection
- Minimal, fast popup UI

## Installation

### From Chrome Web Store
**[Install Cookie DevTools from the Chrome Web Store](https://chromewebstore.google.com/detail/cookie-devtools/pgohmdladleifefhobididhhlmjcknjl)**

<!-- This line said "*Coming soon*" until 2026-08-26, by which point the listing had
     been live long enough to accumulate users and a review. Verified before editing by
     fetching the public store page: HTTP 200, canonical URL
     chromewebstore.google.com/detail/cookie-devtools/pgohmdladleifefhobididhhlmjcknjl.
     KEEPING THIS TRUE: the extension id is the durable fact and it lives in
     store/cws.json, which is also what the CWS publish flow reads — so the link above
     cannot rot independently of the thing it points at. Anything version- or
     count-shaped (users, rating, "latest version") is deliberately NOT stated here:
     it would be stale within a week and nothing regenerates this file. The store page
     itself is where those live. -->

### From GitHub Release
1. Download the latest `cookie-devtools.zip` from [Releases](https://github.com/brightbar-dev/cookie-devtools/releases)
2. Unzip into a folder
3. Open `chrome://extensions/` and enable "Developer mode"
4. Click "Load unpacked" and select the unzipped folder
5. Click the Cookie DevTools icon on any website

### From Source
1. Clone this repo
2. Open `chrome://extensions/` and enable "Developer mode"
3. Click "Load unpacked" and select the repo directory
4. Click the Cookie DevTools icon on any website

## Permissions

See [PRIVACY_POLICY.md](PRIVACY_POLICY.md) for detailed permission explanations.

## Store Listing Copy

### Title
Cookie DevTools

### Short Description
Developer cookie manager with real-time monitoring, environment profiles, and one-click export to curl. No tracking.

### Detailed Description
Cookie DevTools is a cookie editor and cookie manager built for developers. See, edit, import, export, decode and protect the cookies of the site you're working on — in the toolbar popup or in Chrome's side panel.

No ads. No tracking. No permission warnings at install. Nothing you do here leaves your device.

EDIT COOKIES SAFELY
- Every cookie for the current site, including partitioned (CHIPS) cookies set by embedded frames
- Add, edit and delete with checks for what the browser would reject: SameSite=None without Secure, __Host- and __Secure- prefix rules, the 4096-byte limit, invalid characters
- Edits never destroy the original: if the browser refuses a change, the cookie stays as it was
- Host-only, partition and exact expiry are kept unless you change them
- Delete All asks first, and deletes can be undone

DECODE COOKIE VALUES
- JWT: header and payload, with exp, iat and nbf as dates and a clear expired state (decoded on your device, never verified or sent anywhere)
- URL-encoded, Base64 and Base64URL values, and pretty-printed JSON, each with a copy button

IMPORT AND EXPORT COOKIES
- Import JSON exported by other cookie editors, Playwright or Puppeteer; a Netscape cookies.txt file; Set-Cookie or Cookie headers; or a curl command
- Preview before anything is written: what will be created, what will be replaced, and what will be skipped and why
- Export cookies to JSON, cookies.txt (curl/wget), a curl command or a Cookie header — copy or download, for every cookie or just the ones you select

PROTECT AND BLOCK
- Protect a cookie: when a site changes or deletes it, your saved value is put back
- Block a cookie: it is deleted whenever a site sets it again

WATCH COOKIE CHANGES
- Live view of cookie changes on the page you're on
- Optional recording for one site or all sites, with the cause (set, overwritten, expired, evicted), value and time — off until you turn it on, and kept only on your device

BUILT FOR DAILY DEVELOPER WORK
- Environment profiles: save a site's cookies as "staging-admin" and switch back in one click
- Sort by name, domain, expiry or size; filter by Secure, HttpOnly, Session, Partitioned or SameSite=None
- Side panel that stays open and follows your tabs
- Keyboard friendly: / to search, arrow keys to move, Enter to edit, Delete with undo
- Dark mode, with WCAG AA contrast in both themes

PERFECT FOR
- Debugging sign-in, session and CSRF problems
- Moving a test session between browsers, profiles or automated tests
- Testing consent banners, A/B buckets and feature flags
- Generating curl commands with your session cookies
- Checking third-party and partitioned cookies

PERMISSIONS, PLAINLY
Cookie DevTools asks only for what a cookie editor needs: access to cookies on the sites you open, local storage for your settings, the address of the active tab, and the side panel. It never reads page content, never injects scripts, and never sends data anywhere.

### Category
Developer Tools

### Search terms the description is written for
cookie editor, cookie manager, edit cookies, import cookies, export cookies, cookies.txt, curl cookies, JWT decoder, partitioned cookies (CHIPS), cookie monitor. Competitor names are deliberately not used.

### Images
`store/screenshots/` (5 × 1280×800) and `store/promo/` (440×280, 1400×560), generated from the real extension — see `store/tools/README.md`.
