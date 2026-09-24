import { chromeWebStoreReviewUrl, mountReviewNudge, recordActivation, reviewNudgeCss, type MountOptions } from '@brightbar-dev/review-nudge';
import { t } from './i18n';

/**
 * The one-time review request. @brightbar-dev/review-nudge owns the rules (never on install, only
 * after 8 pieces of real cookie work over 3 days, shown once, "Don't ask again" is final); this file
 * says which item it is for and where problems go. ui/app.ts decides where it may appear.
 *
 * The Firefox build is not on the Chrome Web Store (or Firefox Add-ons), so it never asks.
 */
export const CWS_ITEM_ID = 'pgohmdladleifefhobididhhlmjcknjl';

export const reviewNudgeOptions: Omit<MountOptions, 'storage' | 'name' | 'strings'> = {
  reviewUrl: chromeWebStoreReviewUrl(CWS_ITEM_ID),
  feedbackUrl: 'https://github.com/brightbar-dev/cookie-devtools/issues/new/choose',
};

export function offersReview(isFirefox = import.meta.env.BROWSER === 'firefox'): boolean {
  return !isFirefox;
}

/** Count one piece of cookie work that succeeded. Never lets a storage failure reach it. */
export async function recordCookieWork(): Promise<void> {
  if (!offersReview()) return;
  await recordActivation({ storage: browser.storage.local }).catch(() => {});
}

/** Show the request at the end of `container` if it has been earned. */
export async function showReviewNudge(container: HTMLElement): Promise<void> {
  if (!offersReview()) return;
  const doc = container.ownerDocument;
  const shown = await mountReviewNudge(container, {
    ...reviewNudgeOptions,
    storage: browser.storage.local,
    name: t('appName'),
    strings: {
      prompt: (name) => t('reviewNudgePrompt', name),
      review: t('reviewNudgeReview'),
      feedback: t('reviewNudgeFeedback'),
      dismiss: t('reviewNudgeDismiss'),
    },
  }).catch(() => null);
  if (shown && !doc.getElementById('bb-review-nudge-css')) {
    doc.head.append(Object.assign(doc.createElement('style'), { id: 'bb-review-nudge-css', textContent: reviewNudgeCss }));
  }
}
