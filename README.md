# Cookie DevTools

Developer-focused cookie manager for Chrome with real-time monitoring, environment profiles, and one-click export to curl/wget.

## Features

### Cookie Management
- View all cookies for the current site with search/filter, including partitioned (CHIPS) cookies — first-party and those set by embedded cross-site frames
- Add, edit, and delete cookies
- Safe edits: the new cookie is written before the old one is removed, so a change the browser rejects never destroys the original; the error shows in the editor
- Faithful edits: host-only, partition, cookie store and exact expiry are kept unless you change them
- Validation before you save: SameSite=None and partitioned cookies need Secure, `__Secure-`/`__Host-` prefix rules, forbidden characters, the 4096-byte size limit, 400-day expiry cap, and a confirmation when an expiry in the past would delete the cookie
- Delete All asks first, with the count, and both single deletes and Delete All can be undone for 10 seconds
- Visual attribute badges: Secure, HttpOnly, SameSite, Session, Partitioned
- One-click copy cookie values

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
- **JSON**: Full cookie data with all attributes
- **Cookie File**: curl/wget-compatible cookie file format
- **curl command**: Ready-to-paste curl with -b flag
- **Cookie header**: Raw header string for HTTP requests

### Other
- Dark mode (auto-detects system preference)
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
Cookie DevTools is a developer-focused cookie manager built for debugging, testing, and environment switching.

Unlike basic cookie editors, Cookie DevTools gives you the tools developers actually need: a real-time monitor that shows cookie changes as they happen, environment profiles to save and switch between cookie states, and one-click export to curl, cookie files, or raw headers.

Features:
- View, add, edit, and delete cookies for the current site
- Real-time cookie change monitor with cause tracking (explicit, expired, evicted, overwritten)
- Environment profiles — save and restore named cookie snapshots
- Export to JSON, cookie file (curl/wget), curl command, or Cookie header string
- Visual attribute badges: Secure, HttpOnly, SameSite, Session
- Search and filter across cookie names, values, and domains
- Dark mode with system preference auto-detection
- No tracking, no ads, no data collection

Perfect for:
- Debugging authentication flows
- Switching between dev/staging/prod cookie environments
- Generating curl commands with session cookies
- Monitoring how websites set and modify cookies
- QA testing cookie behavior across environments

### Category
Developer Tools

### Search Keywords
cookie, cookie editor, cookie manager, cookie devtools, editthiscookie, developer tools, cookie export, curl cookies, cookie monitor
