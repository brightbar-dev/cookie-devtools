// Allowlist guard for the built Chrome manifest: fails when it asks for anything beyond what this
// extension ships with, so a new permission, host, optional permission or injected script cannot
// reach the install prompt or contradict the store listing unnoticed.
//
// It does not mean the install prompt is warning-free — it is not. For this set Chrome shows one
// line, "Read and change all your data on all websites", which comes from <all_urls>: reading and
// writing a site's cookies needs host access to that site. Measured 2026-09-15 in Chrome for
// Testing 151 with chrome.management.getPermissionWarningsByManifest(JSON.stringify(manifest), cb),
// called from any extension page (it needs no `management` permission). Beside <all_urls>, adding
// `tabs` or `devtools_page` adds no line; `clipboardWrite` adds "Modify data you copy and paste".
//
// Before widening an allowlist here, measure the warnings that way on the manifest before and
// after, and put both lists in the PR. Never read developerPrivate.getExtensionsInfo()
// .permissions.simplePermissions for this: it omits host-permission warnings, and trusting it once
// put a false "no install warnings" claim on the listing.
import fs from 'node:fs';

const path = process.argv[2] ?? '.output/chrome-mv3/manifest.json';
const manifest = JSON.parse(fs.readFileSync(path, 'utf8'));

const ALLOWED_PERMISSIONS = new Set(['cookies', 'storage', 'activeTab', 'sidePanel']);
const ALLOWED_HOSTS = new Set(['<all_urls>']);
const FORBIDDEN_KEYS = {
  content_scripts: 'the listing says the extension never injects scripts into pages',
  // Held back until the PR that ships a DevTools panel, which records its measured warnings here.
  devtools_page: 'a DevTools panel ships only with its before/after install-warning measurement',
};

const problems = [];
for (const permission of [...(manifest.permissions ?? []), ...(manifest.optional_permissions ?? [])]) {
  if (!ALLOWED_PERMISSIONS.has(permission)) problems.push(`permission "${permission}" is not in the allowlist`);
}
for (const host of [...(manifest.host_permissions ?? []), ...(manifest.optional_host_permissions ?? [])]) {
  if (!ALLOWED_HOSTS.has(host)) problems.push(`host permission "${host}" is not in the allowlist`);
}
for (const [key, why] of Object.entries(FORBIDDEN_KEYS)) {
  if (key in manifest) problems.push(`"${key}" is not allowed: ${why}`);
}

if (problems.length) {
  console.error(`${path}\n  ${problems.join('\n  ')}\n` +
    'Measure install warnings before and after (see the top of scripts/check-manifest.mjs), then widen the allowlist in the same PR.');
  process.exit(1);
}
const requested = [...(manifest.permissions ?? []), ...(manifest.host_permissions ?? [])];
console.log(`${path}: within the allowlist (${requested.join(', ')})`);
