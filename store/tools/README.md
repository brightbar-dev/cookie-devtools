# Store listing images

`store/screenshots/` (1280×800) and `store/promo/` (440×280 small tile, 1400×560 marquee) are generated from the real extension, so they can be regenerated whenever the UI changes. Regenerate them in the same PR as any UI change they show.

1. `pnpm exec wxt build`
2. `node store/tools/capture.mjs` loads `.output/chrome-mv3` into Chrome for Testing. It opens "Acme Analytics", a fixture app served over HTTPS at `app.acme.test` with an embedded `widget.helpdesk.test` iframe (see `fixture.mjs`), and captures the popup, editor, import dialog, Monitor and side panel at 2× into `store/.raw/`.
3. `node store/tools/compose.mjs` adds captions with HTML, then writes RGB PNGs with no alpha into `store/screenshots/` and `store/promo/`.

Environment:
- `CHROME_FOR_TESTING` — required. Path to a Chrome for Testing binary; branded Chrome ignores `--load-extension`.
- `PLAYWRIGHT_MODULE` — optional. Path to Playwright's `index.mjs` if `playwright` does not resolve from the repo.
- Also needs `openssl` (generates a throwaway certificate in `store/.cert/`) and Pillow for Python 3.

`store/.raw/` and `store/.cert/` are git-ignored. The side-panel image is a composite of two real renders — the fixture page and `sidepanel.html` — framed as a browser window.

`store-assets/` holds the previous listing's images (v0.2 UI). It is kept for reference and superseded by `store/screenshots/` and `store/promo/`.
