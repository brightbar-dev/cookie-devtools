import { mountApp } from '@/ui/app';

// The side panel stays open, so it follows whichever tab is active in its window.
// Reading tab.url needs no `tabs` permission: the <all_urls> host permission covers it.
void mountApp(document.getElementById('app')!, {
  mode: 'sidepanel',
  currentUrl: async () => (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.url,
  onTargetChanged: (listener) => {
    browser.tabs.onActivated.addListener(() => listener());
    browser.tabs.onUpdated.addListener((_tabId, info, tab) => {
      if (tab.active && (info.url || info.status === 'complete')) listener();
    });
  },
});
