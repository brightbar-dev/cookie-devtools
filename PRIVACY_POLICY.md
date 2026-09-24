# Privacy Policy — Cookie DevTools

**Last updated:** 2026-09-24

## Data Collection
Cookie DevTools does **not** collect, transmit, or share any user data. All data stays on your device.

## Permissions Explained
- **cookies**: Required to read, create, edit, and delete browser cookies (the core functionality).
- **storage**: Used to save your preferences, cookie profiles, and change log locally on your device.
- **activeTab**: Used to detect the current tab's URL so we can show cookies for the site you're viewing. (The broader `tabs` permission was removed — `activeTab` plus the `<all_urls>` host permission already cover this.)
- **sidePanel**: Shows the same cookie tools in Chrome's side panel. It gives the extension no access to any data.
- **host_permissions (<all_urls>)**: Required by the chrome.cookies API to access cookies across all domains. Chrome shows this at install as "Read and change all your data on all websites". Cookie DevTools uses it only to read and write cookies and to see which site the active tab is on; it never reads page content or injects scripts.

## Data Storage
- Cookie profiles are stored locally using `chrome.storage.local`.
- The change monitor records nothing until you switch **Record** on in its tab. While it is on, each cookie change (name, value, domain, time) is kept in `chrome.storage.local` — for all sites, or only the one site you choose — up to the log size set in Settings. Clear it from the Monitor tab or Settings at any time.
- Cookies you import are read from the text you paste or the file you choose, inside the extension; exports are copied to your clipboard or saved as a file on your device.
- Protect and Block rules (the cookie's name and domain, and for a protected cookie its saved value and attributes) are stored locally so the extension can enforce them.
- So that the popup asks for a store review at most once, and only after real use, a small counter is kept in `chrome.storage.local`: how many times a cookie action succeeded, on how many days, and whether you have answered the request. It holds no cookie names, values or sites.
- No data is sent to any server or third party.

## Contact
For questions about this privacy policy, open an issue on our GitHub repository.
