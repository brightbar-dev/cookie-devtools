// Realistic HTTPS fixture for the store screenshots: "Acme Analytics" at app.acme.test with a support widget
// from widget.helpdesk.test. Hosts are mapped to 127.0.0.1 by the browser's --host-resolver-rules.
import https from 'node:https';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const STORE_PORT = 18443;
const CERT = 'store/.cert';

// A throwaway self-signed certificate for the fixture hosts (the browser is told to ignore it).
function ensureCert() {
  if (fs.existsSync(`${CERT}/cert.pem`)) return;
  fs.mkdirSync(CERT, { recursive: true });
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${CERT}/key.pem`, '-out', `${CERT}/cert.pem`,
    '-days', '30', '-subj', '/CN=acme.test', '-addext', 'subjectAltName=DNS:acme.test,DNS:*.acme.test,DNS:*.helpdesk.test'], { stdio: 'ignore' });
}

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sessionJwt() {
  const now = Math.floor(Date.now() / 1000);
  return `${b64u({ alg: 'RS256', typ: 'JWT', kid: 'acme-2026-09' })}.${b64u({ sub: 'user_48213', email: 'dana@acme.test', name: 'Dana Whitfield', role: 'admin', org: 'acme-eu', iat: now - 1800, exp: now + 2700 })}.${crypto.randomBytes(64).toString('base64url')}`;
}

const DAY = 86400;
const common = (res, extra = []) => res.setHeader('Set-Cookie', extra);

function dashboardCookies() {
  return [
    `__Host-session=${sessionJwt()}; Path=/; Secure; HttpOnly; SameSite=Lax`,
    `refresh_token=${crypto.randomBytes(48).toString('base64url')}; Path=/auth; Secure; HttpOnly; SameSite=Strict; Max-Age=${30 * DAY}`,
    `__Host-csrf=${crypto.randomBytes(16).toString('hex')}; Path=/; Secure; SameSite=Strict`,
    `prefs=${encodeURIComponent(JSON.stringify({ theme: 'dark', tz: 'Europe/Berlin', density: 'compact' }))}; Path=/; Secure; SameSite=Lax; Max-Age=${365 * DAY}`,
    `feature_flags=${Buffer.from(JSON.stringify({ newBilling: true, betaCharts: false, exportV2: true })).toString('base64')}; Path=/; Secure; Max-Age=${7 * DAY}`,
    `_acme_id=GA1.2.1837461925.1757894400; Domain=acme.test; Path=/; Secure; SameSite=Lax; Max-Age=${400 * DAY}`,
    `consent=analytics%3Dgranted%26ads%3Ddenied; Path=/; Secure; SameSite=Lax; Max-Age=${180 * DAY}`,
    `ab_bucket=checkout-v2%3AB; Path=/; Secure; SameSite=Lax`,
  ];
}

const PAGE = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  *{box-sizing:border-box;margin:0}
  body{font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;background:#f1f5f9}
  .top{height:56px;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;gap:28px;padding:0 24px}
  .logo{font-weight:700;color:#fff;letter-spacing:.2px}.logo b{color:#818cf8}
  .top a{color:#94a3b8;text-decoration:none}.top .me{margin-left:auto;display:flex;align-items:center;gap:10px;color:#cbd5e1}
  .avatar{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#818cf8,#22d3ee)}
  main{padding:24px;display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
  .card{background:#fff;border-radius:10px;padding:18px;box-shadow:0 1px 2px rgba(15,23,42,.06)}
  .card h3{font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#64748b}
  .num{font-size:30px;font-weight:700;margin-top:6px}.up{color:#16a34a;font-size:12px}
  .wide{grid-column:span 2;height:260px;position:relative}
  .bars{position:absolute;left:18px;right:18px;bottom:18px;top:60px;display:flex;align-items:flex-end;gap:10px}
  .bars div{flex:1;border-radius:4px 4px 0 0;background:linear-gradient(#818cf8,#6366f1)}
  .list div{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9}
  iframe{position:fixed;right:20px;bottom:20px;width:64px;height:64px;border:0;border-radius:50%}
</style></head><body>${body}</body></html>`;

const DASHBOARD = PAGE('Dashboard · Acme Analytics', `
  <div class="top"><span class="logo">acme<b>analytics</b></span><a>Dashboard</a><a>Reports</a><a>Billing</a><a>Settings</a>
  <span class="me">Dana Whitfield <span class="avatar"></span></span></div>
  <main>
    <div class="card"><h3>Active users</h3><div class="num">48,213</div><span class="up">▲ 12.4% this week</span></div>
    <div class="card"><h3>Revenue</h3><div class="num">€182.4k</div><span class="up">▲ 3.1%</span></div>
    <div class="card"><h3>Checkout conversion</h3><div class="num">4.82%</div><span class="up">▲ 0.4 pts</span></div>
    <div class="card wide"><h3>Sessions, last 14 days</h3><div class="bars">${[42, 55, 48, 61, 58, 72, 66, 70, 79, 74, 83, 88, 81, 92].map((h) => `<div style="height:${h}%"></div>`).join('')}</div></div>
    <div class="card list"><h3>Top pages</h3><div><span>/checkout</span><b>12.8k</b></div><div><span>/pricing</span><b>9.1k</b></div><div><span>/docs/api</span><b>7.4k</b></div><div><span>/login</span><b>6.2k</b></div></div>
  </main>
  <iframe src="https://widget.helpdesk.test:${STORE_PORT}/chat"></iframe>`);

export function startStoreFixture() {
  ensureCert();
  const server = https.createServer({ key: fs.readFileSync(`${CERT}/key.pem`), cert: fs.readFileSync(`${CERT}/cert.pem`) }, (req, res) => {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const host = (req.headers.host || '').split(':')[0];
    if (host === 'widget.helpdesk.test' && url.pathname === '/chat') {
      common(res, [`hd_visitor=v_${crypto.randomBytes(6).toString('hex')}; Path=/; Secure; SameSite=None; Partitioned; Max-Age=${90 * DAY}`]);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><body style="margin:0;background:#6366f1;border-radius:50%;height:64px"></body>');
      return;
    }
    if (url.pathname === '/' || url.pathname === '/dashboard') {
      common(res, dashboardCookies());
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(DASHBOARD);
      return;
    }
    if (url.pathname === '/logout') {
      common(res, [
        '__Host-session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0',
        'refresh_token=; Path=/auth; Secure; HttpOnly; SameSite=Strict; Max-Age=0',
        `anon_cart=${encodeURIComponent(JSON.stringify({ items: 2 }))}; Path=/; Secure; SameSite=Lax; Max-Age=${3 * DAY}`,
      ]);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(PAGE('Signed out', '<div class="top"><span class="logo">acme<b>analytics</b></span></div><main><div class="card">Signed out</div></main>'));
      return;
    }
    if (url.pathname === '/login') {
      common(res, [
        `__Host-csrf=${crypto.randomBytes(16).toString('hex')}; Path=/; Secure; SameSite=Strict`,
        `login_state=${crypto.randomBytes(12).toString('base64url')}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`,
      ]);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(PAGE('Sign in', '<div class="top"><span class="logo">acme<b>analytics</b></span></div><main><div class="card">Sign in</div></main>'));
      return;
    }
    if (url.pathname === '/session') {
      common(res, [
        ...dashboardCookies(),
        'login_state=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0',
        'anon_cart=; Path=/; Secure; SameSite=Lax; Max-Age=0',
        `last_login=${Math.floor(Date.now() / 1000)}; Path=/; Secure; SameSite=Lax; Max-Age=${30 * DAY}`,
      ]);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(DASHBOARD);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(STORE_PORT, '127.0.0.1', () => resolve(server));
  });
}
