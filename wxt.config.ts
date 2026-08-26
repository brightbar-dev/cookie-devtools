import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: '__MSG_appName__',
    description: '__MSG_appDescription__',
    default_locale: 'en',
    // `tabs` deliberately NOT requested (removed 2026-08-26). The only tabs API this
    // extension calls is browser.tabs.query({active:true,currentWindow:true}) in
    // entrypoints/popup/main.ts, and it reads exactly one field off the result: tab.url.
    //
    // Chrome's own reference for the Tabs API, quoted verbatim (fetched 2026-08-26 from
    // developer.chrome.com/docs/extensions/reference/api/tabs):
    //
    //   The "tabs" permission ... grants an extension the ability to call tabs.query()
    //   against four sensitive properties on tabs.Tab instances: url, pendingUrl, title,
    //   and favIconUrl.
    //
    //   Host permissions allow an extension to read and query a matching tab's four
    //   sensitive tabs.Tab properties.
    //
    //   The "activeTab" permission ... grants an extension temporary host permission for
    //   the current tab in response to a user invocation. Unlike host permissions,
    //   activeTab does not trigger any warnings.
    //
    // So tab.url is unlocked twice over here — by `<all_urls>` below, and by `activeTab`
    // when a user has narrowed site access to on-click (opening the popup IS the
    // invocation). `tabs` bought nothing and cost the "Read your browsing history"
    // install warning, which is the scariest string in the whole install prompt for an
    // extension whose entire pitch is that it does not track you.
    //
    // NOT verified by running it: the reasoning above is a citation, not a smoke test,
    // and the two sibling extensions that looked like precedent (devtools-pro,
    // tailwind-lookup) turned out to read only tab.id, which was never gated. Load the
    // built extension unpacked and confirm the popup still shows the current domain
    // before this ships in a release.
    permissions: ['cookies', 'storage', 'activeTab'],
    host_permissions: ['<all_urls>'],
  },
});
