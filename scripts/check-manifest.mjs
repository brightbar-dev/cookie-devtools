// Fails when a built Chrome manifest adds anything that puts a warning on the install prompt.
// Why each allowed entry is warning-free is recorded in wxt.config.ts.
import fs from 'node:fs';

const path = process.argv[2] ?? '.output/chrome-mv3/manifest.json';
const manifest = JSON.parse(fs.readFileSync(path, 'utf8'));

const ALLOWED_PERMISSIONS = new Set(['cookies', 'storage', 'activeTab', 'sidePanel']);
const ALLOWED_HOSTS = ['<all_urls>'];
// Not permissions, but measured to add "Read and change all your data on all websites".
const WARNING_KEYS = ['devtools_page'];

const problems = [];
for (const permission of manifest.permissions ?? []) {
  if (!ALLOWED_PERMISSIONS.has(permission)) problems.push(`permission "${permission}" is not in the warning-free set`);
}
for (const host of manifest.host_permissions ?? []) {
  if (!ALLOWED_HOSTS.includes(host)) problems.push(`host permission "${host}" is new`);
}
for (const key of WARNING_KEYS) {
  if (key in manifest) problems.push(`"${key}" makes Chrome warn "Read and change all your data on all websites"`);
}

if (problems.length) {
  console.error(`${path}\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`${path}: ${(manifest.permissions ?? []).join(', ')} — no install warning added`);
