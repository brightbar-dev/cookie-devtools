# Privacy Policy — Cookie DevTools

**Last updated:** 2026-09-15

## Data Collection
Cookie DevTools does **not** collect, transmit, or share any user data. All data stays on your device.

## Permissions Explained
- **cookies**: Required to read, create, edit, and delete browser cookies (the core functionality).
- **storage**: Used to save your preferences, cookie profiles, and change log locally on your device.
- **activeTab**: Used to detect the current tab's URL so we can show cookies for the site you're viewing. (The broader `tabs` permission was removed — `activeTab` plus the `<all_urls>` host permission already cover this.)
- **host_permissions (<all_urls>)**: Required by the chrome.cookies API to access cookies across all domains.

## Data Storage
- Cookie profiles are stored locally using `chrome.storage.local`.
- The change monitor records nothing until you switch **Record** on in its tab. While it is on, each cookie change (name, value, domain, time) is kept in `chrome.storage.local` — for all sites, or only the one site you choose — up to the log size set in Settings. Clear it from the Monitor tab or Settings at any time.
- No data is sent to any server or third party.

## Contact
For questions about this privacy policy, open an issue on our GitHub repository.
