import { mountApp } from '@/ui/app';

// Opened as a tab (to pick an import file, say), the page to work on arrives as ?url=.
const pageUrl = new URLSearchParams(location.search).get('url');

void mountApp(document.getElementById('app')!, {
  mode: pageUrl ? 'page' : 'popup',
  currentUrl: async () => pageUrl ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.url,
});
