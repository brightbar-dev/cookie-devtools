import { describe, it, expect } from 'vitest';
import { manifestProblems } from '../scripts/check-manifest.mjs';

// What `pnpm exec wxt build` produces for Chrome today.
const BUILT = {
  manifest_version: 3,
  permissions: ['cookies', 'storage', 'activeTab', 'sidePanel'],
  host_permissions: ['<all_urls>'],
  devtools_page: 'devtools.html',
  side_panel: { default_path: 'sidepanel.html' },
};

describe('manifestProblems (CI allowlist guard)', () => {
  it('accepts the shipped permission set, side panel and DevTools page', () => {
    expect(manifestProblems(BUILT)).toEqual([]);
  });

  it('fails on a permission outside the allowlist', () => {
    expect(manifestProblems({ ...BUILT, permissions: [...BUILT.permissions, 'tabs'] })).toEqual([
      'permission "tabs" is not in the allowlist',
    ]);
  });

  it('fails on a new host, required or optional', () => {
    expect(manifestProblems({ ...BUILT, host_permissions: ['<all_urls>', 'file:///*'] })).toHaveLength(1);
    expect(manifestProblems({ ...BUILT, optional_host_permissions: ['https://*/*'] })).toEqual([
      'host permission "https://*/*" is not in the allowlist',
    ]);
  });

  it('checks optional permissions too', () => {
    expect(manifestProblems({ ...BUILT, optional_permissions: ['downloads'] })).toEqual([
      'permission "downloads" is not in the allowlist',
    ]);
  });

  it('fails on content scripts, which the listing promises never to inject', () => {
    const problems = manifestProblems({ ...BUILT, content_scripts: [{ matches: ['<all_urls>'], js: ['x.js'] }] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('content_scripts');
  });
});
