// Captures the real extension UI on the Acme fixture at 2x, for the store screenshots.
// Usage (from the repo root, after `pnpm exec wxt build`): node store/tools/capture.mjs [.output/chrome-mv3]
import fs from 'node:fs';
import { startStoreFixture, STORE_PORT } from './fixture.mjs';

// PLAYWRIGHT_MODULE: path to playwright's index.mjs (or leave unset if `playwright` resolves).
// CHROME_FOR_TESTING: a Chrome for Testing binary — branded Chrome ignores --load-extension.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const EXE = process.env.CHROME_FOR_TESTING;
if (!EXE) throw new Error('Set CHROME_FOR_TESTING to a Chrome for Testing binary.');
const EXT = process.argv[2] ?? '.output/chrome-mv3';
const RAW = 'store/.raw';
fs.rmSync(RAW, { recursive: true, force: true });
fs.mkdirSync(RAW, { recursive: true });
const ORIGIN = `https://app.acme.test:${STORE_PORT}`;
const DASH = `${ORIGIN}/dashboard`;

const server = await startStoreFixture();
const profile = `${RAW}/profile`;
const ctx = await chromium.launchPersistentContext(profile, {
  headless: true,
  executablePath: EXE,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  ignoreHTTPSErrors: true,
  // Times in the UI read as a working morning for the fixture's EU org, whenever this runs.
  locale: 'en-US',
  timezoneId: 'Europe/Berlin',
  colorScheme: 'light',
  args: [
    `--disable-extensions-except=${fs.realpathSync(EXT)}`, `--load-extension=${fs.realpathSync(EXT)}`,
    '--host-resolver-rules=MAP *.acme.test 127.0.0.1,MAP *.helpdesk.test 127.0.0.1',
    '--ignore-certificate-errors',
  ],
});
let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;

async function extPage(file, target, viewport, colorScheme = 'light', stubSidePanel = false) {
  const p = await ctx.newPage();
  await p.setViewportSize(viewport);
  await p.emulateMedia({ colorScheme });
  await p.addInitScript(({ tUrl, stub }) => {
    const fakeTab = { id: 7, url: tUrl, active: true, windowId: 1, index: 0 };
    const origQuery = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = (q, cb) => { if (q && q.active) { if (cb) { cb([fakeTab]); return undefined; } return Promise.resolve([fakeTab]); } return origQuery(q, cb); };
    if (stub) { chrome.tabs.onActivated.addListener = () => {}; chrome.tabs.onUpdated.addListener = () => {}; }
  }, { tUrl: target, stub: stubSidePanel });
  await p.goto(`chrome-extension://${id}/${file}`);
  await p.waitForTimeout(900);
  return p;
}
const row = (p, name, sel) => p.evaluate(({ name, sel }) => {
  const it = [...document.querySelectorAll('.cookie-item')].find((i) => i.querySelector('.cookie-name').title === name);
  it.querySelector(sel).click();
}, { name, sel });
const POPUP = { width: 520, height: 600 };

// the site: dashboard with its embedded support widget
const site = await ctx.newPage();
await site.setViewportSize({ width: 880, height: 744 });
await site.goto(DASH);
await site.waitForTimeout(1200);
await site.screenshot({ path: `${RAW}/site-dashboard.png` });

// 1. list: badges, chips, sizes, partitioned + a protected cookie
await sw.evaluate(async (origin) => {
  const [consent] = await chrome.cookies.getAll({ url: origin + '/', name: 'consent' });
  const id = [consent.storeId || '0', consent.domain.toLowerCase(), consent.path, consent.name, ''].join('');
  await chrome.storage.local.set({ rules: { protect: [{ id, cookie: consent, createdAt: Date.now() }], block: [] }, listSort: { key: 'name', dir: 'asc' } });
}, ORIGIN);
let p = await extPage('popup.html', DASH, POPUP);
await p.screenshot({ path: `${RAW}/1-list.png` });
console.log('list:', await p.$$eval('.cookie-name', (els) => els.map((e) => e.title).join(',')), '|', await p.textContent('#btn-rules'));

// 2. editor with the JWT inspector
await row(p, '__Host-session', '.btn-edit');
await p.waitForTimeout(500);
await p.screenshot({ path: `${RAW}/2-jwt.png` });
console.log('jwt status:', await p.textContent('.jwt-status'));
await p.keyboard.press('Escape');

// 3. import preview: a teammate's Cookie-Editor export with problems
await p.click('#btn-import');
const now = Math.floor(Date.now() / 1000);
const exportJson = JSON.stringify([
  { domain: 'staging.acme.test', expirationDate: now + 7 * 86400, hostOnly: true, httpOnly: true, name: '__Host-session', path: '/', sameSite: 'lax', secure: true, session: false, storeId: '0', value: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyXzQ4MjEzIn0.c2ln' },
  { domain: 'staging.acme.test', hostOnly: true, httpOnly: false, name: 'prefs', path: '/', sameSite: 'lax', secure: true, session: true, storeId: '0', value: 'theme%3Dlight' },
  { domain: '.acme.test', expirationDate: now + 300 * 86400, hostOnly: false, httpOnly: false, name: '_acme_id', path: '/', sameSite: 'lax', secure: true, session: false, storeId: '0', value: 'GA1.2.1837461925.1757894400' },
  { domain: 'app.acme.test', expirationDate: now + 86400, hostOnly: true, httpOnly: false, name: 'ab_bucket', path: '/', sameSite: 'lax', secure: true, session: false, storeId: '0', value: 'checkout-v2%3AA' },
  { domain: 'staging.acme.test', expirationDate: now - 3600, hostOnly: true, httpOnly: true, name: 'refresh_token', path: '/auth', sameSite: 'strict', secure: true, session: false, storeId: '0', value: 'expired' },
  { domain: 'staging.acme.test', hostOnly: true, httpOnly: false, name: 'embed_pref', path: '/', sameSite: 'no_restriction', secure: false, session: true, storeId: '0', value: '1' },
], null, 2);
await p.fill('#import-text', exportJson);
await p.waitForTimeout(600);
await p.evaluate(() => { document.getElementById('import-text').scrollTop = 0; });
await p.screenshot({ path: `${RAW}/3-import.png` });
console.log('import:', (await p.textContent('.import-summary')).trim());
await p.click('#btn-import-cancel');

// 4. monitor recording a sign-out → sign-in flow, this site only
await p.close();
await sw.evaluate(() => chrome.storage.local.set({ monitor: { recording: true, scope: 'site', site: 'app.acme.test' }, changeLog: [] }));
await site.goto(`${ORIGIN}/logout`);
await site.waitForTimeout(400);
await site.goto(`${ORIGIN}/login`);
await site.waitForTimeout(400);
await site.goto(`${ORIGIN}/session`);
await site.waitForTimeout(1600);
p = await extPage('popup.html', DASH, POPUP);
await p.click('.tab[data-tab="monitor"]');
await p.waitForTimeout(800);
await p.screenshot({ path: `${RAW}/4-monitor.png` });
console.log('monitor entries:', await p.$$eval('.change-entry', (els) => els.length));
await p.close();
await sw.evaluate(() => chrome.storage.local.set({ monitor: { recording: false, scope: 'all', site: '' } }));

// 5. side panel next to the dashboard
await site.goto(DASH);
await site.waitForTimeout(1200);
await site.screenshot({ path: `${RAW}/site-dashboard.png` });
const panel = await extPage('sidepanel.html', DASH, { width: 400, height: 744 }, 'light', true);
await panel.screenshot({ path: `${RAW}/5-sidepanel.png` });

// dark list for the marquee
const dark = await extPage('popup.html', DASH, POPUP, 'dark');
await dark.screenshot({ path: `${RAW}/6-list-dark.png` });

console.log('captured:', fs.readdirSync(RAW).join(', '));
await ctx.close();
server.close();
