import { describe, it, expect } from 'vitest';
import { parseTarget, noTargetReason, tabUpdateMovesTarget, siteAccessPattern } from '../utils/target';

describe('siteAccessPattern', () => {
  it('covers the whole site on any port and path, as Chrome match patterns do', () => {
    expect(siteAccessPattern('https://app.example.com:8443/orders/42?tab=items')).toBe('https://app.example.com/*');
    expect(siteAccessPattern('http://127.0.0.1:18780/')).toBe('http://127.0.0.1/*');
    expect(siteAccessPattern('http://[::1]:3000/admin')).toBe('http://[::1]/*');
  });
});

describe('tabUpdateMovesTarget', () => {
  it('refreshes on a new URL or a finished load, not on title, favicon or loading changes', () => {
    expect(tabUpdateMovesTarget({ url: 'https://example.com/next' })).toBe(true);
    expect(tabUpdateMovesTarget({ status: 'complete' })).toBe(true);
    expect(tabUpdateMovesTarget({ status: 'loading' })).toBe(false);
    expect(tabUpdateMovesTarget({})).toBe(false);
  });
});

describe('parseTarget', () => {
  it('keeps origin and path, dropping query and fragment', () => {
    expect(parseTarget('https://app.example.com:8443/orders/42?tab=items#top')).toEqual({
      url: 'https://app.example.com:8443/orders/42',
      host: 'app.example.com',
      https: true,
    });
    expect(parseTarget('http://127.0.0.1:18772/')).toEqual({ url: 'http://127.0.0.1:18772/', host: '127.0.0.1', https: false });
  });

  it('has no target for pages without cookies or without a URL', () => {
    for (const raw of ['chrome://extensions/', 'file:///tmp/x.html', 'about:blank', 'chrome-extension://abc/popup.html', 'not a url', '', undefined, null]) {
      expect(parseTarget(raw)).toBeNull();
    }
  });
});

describe('noTargetReason', () => {
  it('explains browser pages', () => {
    for (const raw of ['chrome://extensions/', 'chrome://newtab/', 'edge://settings', 'about:blank', 'chrome-extension://abc/options.html']) {
      expect(noTargetReason(raw).title).toBe('Browser page');
    }
    expect(noTargetReason('chrome://settings').detail).toMatch(/have no cookies/);
  });

  it('explains local files and suggests localhost', () => {
    expect(noTargetReason('file:///Users/me/index.html')).toEqual({
      title: 'Local file',
      detail: expect.stringMatching(/localhost/),
    });
  });

  it('covers no page at all and other schemes', () => {
    expect(noTargetReason(undefined).title).toBe('No page open');
    expect(noTargetReason('ftp://files.example.com/').title).toBe('Not a website');
    expect(noTargetReason('%%%').title).toBe('Not a website');
  });
});
