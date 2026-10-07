// End-to-end: export encrypted, wrong password, tampering, version, then import. Not run by Vitest.
// Usage: pnpm exec wxt build && node tests/e2e/encrypted-share.e2e.mjs [.output/chrome-mv3]
// PLAYWRIGHT_MODULE: path to playwright's index.mjs if it does not resolve; E2E_OUT: screenshot folder.
import fs from 'node:fs';
import http from 'node:http';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const EXT = fs.realpathSync(process.argv[2] ?? '.output/chrome-mv3');
const OUT = process.env.E2E_OUT ?? 'e2e-evidence';
fs.mkdirSync(OUT, { recursive: true });
const server = http.createServer((q, r) => { r.end('ok'); }).listen(8123);
const URL_ = 'http://localhost:8123/';
const ctx = await chromium.launchPersistentContext('/tmp/e2e-profile-' + Date.now(), {
  headless: true, channel: 'chromium', args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let sw = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
const fail = (m) => { console.log('FAIL', m); process.exitCode = 1; };
const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) process.exitCode = 1; };

await sw.evaluate(async (u) => {
  await chrome.cookies.set({ url: u, name: 'sid', value: 'secret-session-1', httpOnly: true, expirationDate: 4102444800 });
  await chrome.cookies.set({ url: u, name: 'theme', value: 'dark', expirationDate: 4102444800 });
}, URL_);
const names = () => sw.evaluate(async (u) => (await chrome.cookies.getAll({ url: u })).map((c) => c.name).sort().join(','), URL_);

async function page(q = '', scheme = 'light') {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 520, height: 640 });
  await p.emulateMedia({ colorScheme: scheme });
  await p.addInitScript((tUrl) => {
    const tab = { id: 7, url: tUrl, active: true, windowId: 1, index: 0 };
    const orig = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = (qq, cb) => (qq && qq.active ? (cb ? (cb([tab]), undefined) : Promise.resolve([tab])) : orig(qq, cb));
  }, URL_);
  await p.goto(`chrome-extension://${id}/popup.html${q}`);
  await p.waitForSelector('.cookie-item');
  return p;
}

// ---- export
let p = await page();
await p.click('#btn-export');
await p.screenshot({ path: `${OUT}/1-export-menu.png` });
await p.click('button[data-action="encrypt"]');
ok(await p.evaluate(() => document.activeElement.id) === 'share-password', 'export dialog focuses the password field');
await p.screenshot({ path: `${OUT}/2-export-dialog-light.png` });

// validation: nothing downloads on bad input
await p.fill('#share-password', 'short');
await p.fill('#share-confirm', 'short');
await p.click('#btn-share-download');
ok((await p.textContent('#share-msg')).includes('at least 8'), 'short password rejected');
await p.fill('#share-password', 'correct horse battery');
await p.fill('#share-confirm', 'different');
await p.click('#btn-share-download');
ok((await p.textContent('#share-msg')).includes('don’t match'), 'mismatch rejected');
await p.fill('#share-confirm', 'correct horse battery');
const [dl] = await Promise.all([p.waitForEvent('download'), p.press('#share-confirm', 'Enter')]);
const file = `${OUT}/session.cookies.enc.json`;
await dl.saveAs(file);
const text = fs.readFileSync(file, 'utf8');
ok(/cookies-localhost-\d{4}-\d\d-\d\d\.cookies\.enc\.json/.test(dl.suggestedFilename()), 'filename ' + dl.suggestedFilename());
ok(!text.includes('secret-session-1') && !text.includes('sid'), 'file contains no plaintext');
ok(JSON.parse(text).version === 1 && JSON.parse(text).kdf.iterations >= 600000, 'versioned, >=600k iterations');
ok(await p.evaluate(() => !document.getElementById('share-dialog').open), 'dialog closed after download');
await p.close();

// dark theme dialogs
p = await page('', 'dark');
await p.click('#btn-export'); await p.click('button[data-action="encrypt"]');
await p.fill('#share-password', 'abc'); await p.click('#btn-share-download');
await p.screenshot({ path: `${OUT}/3-export-dialog-dark.png` });
await p.close();

// ---- import in a new "session": cookies gone
await sw.evaluate(async (u) => { for (const c of await chrome.cookies.getAll({ url: u })) await chrome.cookies.remove({ url: u, name: c.name }); }, URL_);
ok(await names() === '', 'cookies cleared');
p = await page('?url=' + encodeURIComponent(URL_) + '&view=import').catch(async () => null);
if (!p) { // empty list: page() waits for rows
  p = await ctx.newPage();
}
await p.close();
p = await ctx.newPage();
await p.setViewportSize({ width: 520, height: 640 });
await p.addInitScript((tUrl) => {
  const tab = { id: 7, url: tUrl, active: true, windowId: 1, index: 0 };
  const orig = chrome.tabs.query.bind(chrome.tabs);
  chrome.tabs.query = (qq, cb) => (qq && qq.active ? (cb ? (cb([tab]), undefined) : Promise.resolve([tab])) : orig(qq, cb));
}, URL_);
await p.goto(`chrome-extension://${id}/popup.html?url=${encodeURIComponent(URL_)}&view=import`);
await p.waitForSelector('#import-dialog[open]');
await p.setInputFiles('#import-file', file);
await p.waitForSelector('#import-password-row:not([hidden])');
ok(await p.evaluate(() => document.activeElement.id) === 'import-password', 'opening an encrypted file focuses the password');
ok((await p.textContent('#btn-import-apply')) === 'Decrypt', 'button says Decrypt');
await p.screenshot({ path: `${OUT}/4-import-locked.png` });

// wrong password
await p.fill('#import-password', 'wrong password!');
await p.press('#import-password', 'Enter');
await p.waitForFunction(() => document.getElementById('import-password-msg').textContent.length > 0);
ok((await p.textContent('#import-password-msg')).includes('Wrong password'), 'wrong password -> clear error');
ok(await names() === '', 'nothing imported after wrong password');
ok((await p.$$('.import-list li')).length === 0, 'no preview after wrong password');
ok(await p.evaluate(() => document.getElementById('import-password').getAttribute('aria-invalid')) === 'true', 'field marked invalid');
await p.screenshot({ path: `${OUT}/5-import-wrong-password.png` });

// right password -> preview -> apply
await p.fill('#import-password', 'correct horse battery');
await p.press('#import-password', 'Enter');
await p.waitForSelector('.import-list li');
ok(await names() === '', 'preview shown, still nothing written');
const rows = await p.$$eval('.import-list .imp-name', (e) => e.map((x) => x.textContent).sort().join(','));
ok(rows === 'sid,theme', 'preview lists sid, theme');
ok((await p.textContent('#btn-import-apply')).startsWith('Import 2'), 'button: ' + await p.textContent('#btn-import-apply'));
await p.screenshot({ path: `${OUT}/6-import-preview.png` });
await p.click('#btn-import-apply');
await p.waitForFunction(() => document.getElementById('btn-import-apply').textContent === 'Done');
ok(await names() === 'sid,theme', 'cookies restored: ' + await names());
const sid = await sw.evaluate(async (u) => (await chrome.cookies.getAll({ url: u, name: 'sid' }))[0], URL_);
ok(sid.value === 'secret-session-1' && sid.httpOnly, 'value and HttpOnly preserved');

// tampered file
const tampered = JSON.parse(text); tampered.ciphertext = tampered.ciphertext.slice(0, 10) + (tampered.ciphertext[10] === 'A' ? 'B' : 'A') + tampered.ciphertext.slice(11);
await sw.evaluate(async (u) => { for (const c of await chrome.cookies.getAll({ url: u })) await chrome.cookies.remove({ url: u, name: c.name }); }, URL_);
await p.reload();
await p.waitForSelector('#import-dialog[open]');
await p.fill('#import-text', JSON.stringify(tampered));
await p.waitForSelector('#import-password-row:not([hidden])');
await p.fill('#import-password', 'correct horse battery'); await p.press('#import-password', 'Enter');
await p.waitForFunction(() => document.getElementById('import-password-msg').textContent.length > 0);
ok(await names() === '', 'tampered file: error, nothing imported');
// newer version
await p.fill('#import-text', JSON.stringify({ ...JSON.parse(text), version: 9 }));
await p.waitForSelector('.import-error');
ok((await p.textContent('.import-error')).includes('version 9'), 'newer version message');
await ctx.close(); server.close();
