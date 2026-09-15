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
//
// `devtools_page` (entrypoints/devtools) is not a permission and is allowed. Measured 2026-09-15 in
// Chrome for Testing 151 on the built manifests: without it and with it, the warnings are the same
// ["Read and change all your data on all websites"], because <all_urls> already carries that line.
// (On an extension with no host permissions, a devtools_page does add it.)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ALLOWED_PERMISSIONS = new Set(['cookies', 'storage', 'activeTab', 'sidePanel']);
export const ALLOWED_HOSTS = new Set(['<all_urls>']);
export const FORBIDDEN_KEYS = {
  content_scripts: 'the listing says the extension never injects scripts into pages',
};

/** What a manifest asks for outside the allowlist; empty when it is within it. */
export function manifestProblems(manifest) {
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
  return problems;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.argv[2] ?? '.output/chrome-mv3/manifest.json';
  const manifest = JSON.parse(fs.readFileSync(path, 'utf8'));
  const problems = manifestProblems(manifest);
  if (problems.length) {
    console.error(`${path}\n  ${problems.join('\n  ')}\n` +
      'Measure install warnings before and after (see the top of scripts/check-manifest.mjs), then widen the allowlist in the same PR.');
    process.exit(1);
  }
  const requested = [...(manifest.permissions ?? []), ...(manifest.host_permissions ?? [])];
  console.log(`${path}: within the allowlist (${requested.join(', ')})`);
}
