// Composes 1280x800 store screenshots and promo tiles from real UI captures (capture.mjs),
// rendering captions with HTML in Chrome, then flattening to RGB PNG (no alpha) with Pillow.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Same environment as capture.mjs. Needs Pillow (python3 -m pip install pillow) to flatten the PNGs.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const EXE = process.env.CHROME_FOR_TESTING;
if (!EXE) throw new Error('Set CHROME_FOR_TESTING to a Chrome for Testing binary.');
const RAW = path.resolve('store/.raw');
const OUT = path.resolve('store');
const HTML = path.resolve('store/.raw/html');
const ICON = path.resolve('public/icon-128.png');
fs.rmSync(HTML, { recursive: true, force: true });
fs.mkdirSync(HTML, { recursive: true });
fs.mkdirSync(`${OUT}/screenshots`, { recursive: true });
fs.mkdirSync(`${OUT}/promo`, { recursive: true });

const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif";
const BG = 'radial-gradient(1200px 700px at 85% 20%, #4338ca 0%, rgba(67,56,202,0) 60%), linear-gradient(135deg, #0b1020 0%, #151a3a 55%, #1e1b4b 100%)';
const base = `*{box-sizing:border-box;margin:0;padding:0} html,body{width:100%;height:100%} body{font-family:${FONT};-webkit-font-smoothing:antialiased;background:${BG};color:#fff;overflow:hidden}`;

function scene({ title, sub, bullets, image, imageWidth = 520, imageHeight = 600 }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${base}
    .wrap{position:relative;width:1280px;height:800px;display:flex;align-items:center;padding:0 72px;gap:64px}
    .text{flex:1;min-width:0}
    .eyebrow{display:inline-flex;align-items:center;gap:10px;font-size:15px;font-weight:600;letter-spacing:.3px;color:#c7d2fe;margin-bottom:22px}
    .eyebrow img{width:28px;height:28px;border-radius:6px}
    h1{font-size:50px;line-height:1.06;font-weight:750;letter-spacing:-.8px;margin-bottom:20px}
    p.sub{font-size:21px;line-height:1.45;color:#c7d2fe;margin-bottom:30px;max-width:520px}
    ul{list-style:none;display:flex;flex-direction:column;gap:14px}
    li{font-size:18px;color:#e0e7ff;display:flex;align-items:flex-start;gap:12px;line-height:1.35}
    li::before{content:'';flex:none;width:20px;height:20px;margin-top:1px;border-radius:50%;background:#818cf8 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath d='M5.5 10.5l3 3 6-7' fill='none' stroke='%230b1020' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/14px no-repeat}
    .shot{flex:none;width:${imageWidth}px;height:${imageHeight}px;border-radius:14px;overflow:hidden;box-shadow:0 40px 90px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.12)}
    .shot img{display:block;width:100%;height:100%;object-fit:cover;object-position:top left}
  </style></head><body><div class="wrap">
    <div class="text">
      <div class="eyebrow"><img src="file://${ICON}">Cookie DevTools</div>
      <h1>${title}</h1><p class="sub">${sub}</p>
      <ul>${bullets.map((b) => `<li>${b}</li>`).join('')}</ul>
    </div>
    <div class="shot"><img src="file://${image}"></div>
  </div></body></html>`;
}

const scenes = [
  {
    file: '01-cookie-list',
    title: 'Every cookie,<br>at a glance',
    sub: 'Badges, expiry and size on every row, with filters for Secure, HttpOnly, Session, Partitioned and SameSite=None.',
    bullets: ['Shows partitioned (CHIPS) cookies from embedded frames', 'Sort by name, domain, expiry or size', 'Edits the browser would reject are caught before you save'],
    image: `${RAW}/1-list.png`,
  },
  {
    file: '02-jwt-inspector',
    title: 'Decode JWTs, Base64<br>and JSON in place',
    sub: 'Read a token’s claims and expiry right beside its value — decoded on your device, never sent anywhere.',
    bullets: ['exp, iat and nbf as real dates, with expired state', 'URL-encoded and Base64 JSON, pretty-printed', 'Copy any decoded view'],
    image: `${RAW}/2-jwt.png`,
  },
  {
    file: '03-import-preview',
    title: 'Import from anywhere,<br>preview first',
    sub: 'JSON from other cookie tools and Playwright, cookies.txt, Set-Cookie headers or a curl command.',
    bullets: ['See what will be created, replaced and skipped — and why', 'Nothing is written until you confirm', 'Export back to JSON, cookies.txt, curl or a header'],
    image: `${RAW}/3-import.png`,
  },
  {
    file: '04-monitor-login-flow',
    title: 'Watch a sign-in flow,<br>cookie by cookie',
    sub: 'Record one site’s cookie changes — set, overwritten, expired or deleted — with the value and the time.',
    bullets: ['Off until you turn it on', 'Kept only on your device, cleared in one click', 'Live view of the page you’re on, no recording needed'],
    image: `${RAW}/4-monitor.png`,
  },
];

const sidePanelScene = `<!doctype html><html><head><meta charset="utf-8"><style>${base}
  .wrap{width:1280px;height:800px;padding:26px 40px 0}
  .head{display:flex;align-items:baseline;gap:18px;margin-bottom:20px}
  h1{font-size:38px;font-weight:750;letter-spacing:-.6px;white-space:nowrap}
  p{font-size:19px;color:#c7d2fe}
  .win{width:1200px;height:698px;border-radius:12px 12px 0 0;overflow:hidden;background:#dee1e6;box-shadow:0 30px 80px rgba(0,0,0,.5)}
  .bar{height:44px;display:flex;align-items:center;gap:12px;padding:0 16px;background:#dee1e6}
  .dots{display:flex;gap:7px}.dots i{width:12px;height:12px;border-radius:50%;background:#ff5f57}.dots i+i{background:#febc2e}.dots i+i+i{background:#28c840}
  .url{flex:1;height:30px;border-radius:15px;background:#fff;display:flex;align-items:center;padding:0 14px;font-size:14px;color:#3c4043}
  .url b{color:#202124;font-weight:500}
  .body{display:flex;height:654px;background:#fff}
  .page{width:800px;height:100%;overflow:hidden}.page img{width:880px;display:block}
  .side{width:400px;height:100%;border-left:1px solid #dadce0;display:flex;flex-direction:column}
  .sidehead{height:38px;display:flex;align-items:center;gap:8px;padding:0 12px;font-size:13px;color:#3c4043;border-bottom:1px solid #dadce0;background:#f8f9fa}
  .sidehead img{width:16px;height:16px}
  .side .ui{flex:1;overflow:hidden}.side .ui img{width:400px;display:block}
</style></head><body><div class="wrap">
  <div class="head"><h1>Keep it open beside your app</h1><p>The side panel follows the tab you’re on.</p></div>
  <div class="win">
    <div class="bar"><span class="dots"><i></i><i></i><i></i></span><span class="url">🔒&nbsp; <b>app.acme.test</b>/dashboard</span></div>
    <div class="body">
      <div class="page"><img src="file://${RAW}/site-dashboard.png"></div>
      <div class="side"><div class="sidehead"><img src="file://${ICON}">Cookie DevTools</div><div class="ui"><img src="file://${RAW}/5-sidepanel.png"></div></div>
    </div>
  </div>
</div></body></html>`;

const small = `<!doctype html><html><head><meta charset="utf-8"><style>${base}
  .wrap{width:440px;height:280px;padding:34px 34px;display:flex;flex-direction:column;justify-content:center}
  .row{display:flex;align-items:center;gap:16px;margin-bottom:18px}
  .row img{width:64px;height:64px;border-radius:14px}
  h1{font-size:31px;font-weight:750;letter-spacing:-.4px;line-height:1.05}
  .tag{font-size:17px;color:#e0e7ff;margin-bottom:14px}
  .trust{font-size:13px;color:#a5b4fc;letter-spacing:.2px}
</style></head><body><div class="wrap">
  <div class="row"><img src="file://${ICON}"><h1>Cookie<br>DevTools</h1></div>
  <div class="tag">Edit · Import · Decode · Protect</div>
  <div class="trust">No ads · No install warnings · Stays on your device</div>
</div></body></html>`;

const marquee = `<!doctype html><html><head><meta charset="utf-8"><style>${base}
  .wrap{width:1400px;height:560px;display:flex;align-items:center;padding:0 90px;gap:70px}
  .text{flex:1}
  .row{display:flex;align-items:center;gap:14px;margin-bottom:22px;font-size:20px;font-weight:600;color:#c7d2fe}
  .row img{width:44px;height:44px;border-radius:10px}
  h1{font-size:54px;line-height:1.05;font-weight:780;letter-spacing:-1px;margin-bottom:20px}
  p{font-size:21px;line-height:1.45;color:#c7d2fe;margin-bottom:26px;max-width:640px}
  .pills{display:flex;flex-wrap:wrap;gap:10px}
  .pills span{font-size:15px;padding:7px 14px;border-radius:999px;background:rgba(129,140,248,.18);border:1px solid rgba(165,180,252,.35);color:#e0e7ff}
  .shot{flex:none;width:430px;height:496px;border-radius:14px;overflow:hidden;box-shadow:0 40px 90px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.12)}
  .shot img{width:100%;height:100%;object-fit:cover;object-position:top left;display:block}
</style></head><body><div class="wrap">
  <div class="text">
    <div class="row"><img src="file://${ICON}">Cookie DevTools</div>
    <h1>The cookie editor<br>built for developers</h1>
    <p>Import from any tool, decode JWTs, protect and block cookies, and watch changes live — all on your device.</p>
    <div class="pills"><span>JWT &amp; Base64 decoding</span><span>Import with preview</span><span>Protect &amp; block</span><span>Side panel</span><span>No ads · No install warnings</span></div>
  </div>
  <div class="shot"><img src="file://${RAW}/6-list-dark.png"></div>
</div></body></html>`;

const jobs = [
  ...scenes.map((s) => ({ html: scene(s), out: `${OUT}/screenshots/${s.file}.png`, w: 1280, h: 800 })),
  { html: sidePanelScene, out: `${OUT}/screenshots/05-side-panel.png`, w: 1280, h: 800 },
  { html: small, out: `${OUT}/promo/small-tile-440x280.png`, w: 440, h: 280 },
  { html: marquee, out: `${OUT}/promo/marquee-1400x560.png`, w: 1400, h: 560 },
];

const browser = await chromium.launch({ headless: true, executablePath: EXE, args: ['--allow-file-access-from-files'] });
for (const job of jobs) {
  const htmlPath = `${HTML}/${job.out.split('/').pop().replace('.png', '.html')}`;
  fs.writeFileSync(htmlPath, job.html);
  const page = await browser.newPage({ viewport: { width: job.w, height: job.h }, deviceScaleFactor: 1 });
  await page.goto(`file://${htmlPath}`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: job.out, clip: { x: 0, y: 0, width: job.w, height: job.h } });
  await page.close();
}
await browser.close();

// Flatten to RGB so the store gets no alpha channel, and report what landed.
const report = execFileSync('python3', ['-c', `
import sys, glob
from PIL import Image
for p in sorted(glob.glob('${OUT}/screenshots/*.png') + glob.glob('${OUT}/promo/*.png')):
    im = Image.open(p)
    rgb = im.convert('RGB')
    rgb.save(p, 'PNG', optimize=True)
    check = Image.open(p)
    print(p.split('/store/')[-1], check.size, check.mode)
`]).toString();
console.log(report);
