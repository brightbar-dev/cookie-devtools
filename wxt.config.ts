import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: '__MSG_appName__',
    description: '__MSG_appDescription__',
    default_locale: 'en',
    // `tabs` deliberately NOT requested (removed 2026-08-26). The surfaces call
    // browser.tabs.query({active:true,currentWindow:true}) and tabs.onActivated/onUpdated, and
    // the only field they read off a tab is tab.url.
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
    // invocation). `tabs` would buy nothing the extension uses.
    //
    // Verified by running it (2026-09-15, Chrome for Testing 151, no stubs): with no `tabs`
    // permission, the popup opened by a real toolbar click (CDP Extensions.triggerAction) and the
    // side panel opened from its button both list the current site's cookies, and the side panel
    // follows the tab when it navigates to another origin.
    //
    // Install warnings, measured the same day with chrome.management.getPermissionWarningsByManifest
    // (never developerPrivate's simplePermissions, which omits host-permission warnings):
    //   this manifest (WXT adds sidePanel)   "Read and change all your data on all websites"
    //   plus `tabs` or a `devtools_page`     no extra line
    //   without host_permissions             no warning; plus `tabs`: "Read your browsing history"
    // So dropping `tabs` did not shorten today's prompt — the all-sites line already covers tab
    // URLs — but the extension asks for nothing it does not use. The all-sites line is the price of
    // reading and writing cookies on any site: chrome.cookies ignores `activeTab` (a toolbar click
    // on a manifest without host_permissions reveals the tab URL, yet cookies.getAll returns
    // nothing and cookies.set fails with "No host permissions for cookies").
    // scripts/check-manifest.mjs fails CI if the permission set grows.
    permissions: ['cookies', 'storage', 'activeTab'],
    host_permissions: ['<all_urls>'],
  },
});
