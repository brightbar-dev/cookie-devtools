import { describe, it, expect } from 'vitest';
import { parseTarget, noTargetReason } from '../utils/target';

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
