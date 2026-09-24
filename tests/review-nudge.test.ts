import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { readState } from '@brightbar-dev/review-nudge';
import { CWS_ITEM_ID, offersReview, recordCookieWork, reviewNudgeOptions } from '../utils/review-nudge';
import listing from '../store/cws.json';

describe('review nudge', () => {
  beforeEach(() => fakeBrowser.reset());

  it('asks for a review of this item and no other', () => {
    expect(CWS_ITEM_ID).toBe(listing.extension_id);
    expect(reviewNudgeOptions.reviewUrl).toBe(`https://chromewebstore.google.com/detail/${listing.extension_id}/reviews`);
  });

  it('sends problems to the listing’s support page, not the store', () => {
    expect(reviewNudgeOptions.feedbackUrl.startsWith(listing.support_url)).toBe(true);
  });

  it('never asks in the Firefox build, which is not on the Chrome Web Store', () => {
    expect(offersReview(true)).toBe(false);
    expect(offersReview(false)).toBe(true);
  });

  it('counts each piece of cookie work in storage.local', async () => {
    await recordCookieWork();
    await recordCookieWork();
    const state = await readState({ storage: fakeBrowser.storage.local });
    expect(state).toMatchObject({ status: 'counting', activations: 2, activeDays: 1 });
  });

  it('keeps a storage failure away from the cookie work', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValueOnce(new Error('quota'));
    await expect(recordCookieWork()).resolves.toBeUndefined();
  });
});
