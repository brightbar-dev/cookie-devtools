import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Cookie DevTools',
    permissions: ['cookies', 'storage', 'activeTab', 'tabs'],
    host_permissions: ['<all_urls>'],
  },
});
