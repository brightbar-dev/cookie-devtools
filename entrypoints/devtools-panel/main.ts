import { mountApp } from '@/ui/app';
import { tabUpdateMovesTarget } from '@/utils/target';

// A DevTools panel works on the page DevTools is inspecting, which need not be the active tab.
// tabs.get reads that tab's URL without the `tabs` permission: the <all_urls> host permission
// covers it.
const tabId = browser.devtools.inspectedWindow.tabId;

void mountApp(document.getElementById('app')!, {
  mode: 'devtools',
  currentUrl: async () => (await browser.tabs.get(tabId)).url,
  onTargetChanged: (listener) => {
    browser.devtools.network.onNavigated.addListener(() => listener());
    // Also catches same-document navigations (history.pushState), which change the path cookies match.
    browser.tabs.onUpdated.addListener((id, info) => {
      if (id === tabId && tabUpdateMovesTarget(info)) listener();
    });
  },
});
