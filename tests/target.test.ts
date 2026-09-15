import { describe, it, expect } from 'vitest';
import { parseTarget } from '../utils/target';

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
