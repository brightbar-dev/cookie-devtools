import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: '__MSG_appName__',
    description: '__MSG_appDescription__',
    default_locale: 'en',
    permissions: ['cookies', 'storage', 'activeTab', 'tabs'],
    host_permissions: ['<all_urls>'],
  },
});
