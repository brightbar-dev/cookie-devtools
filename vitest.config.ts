import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  // Let tests import stylesheets (tests/contrast.test.ts reads ui/app.css with ?raw); by default Vitest blanks CSS.
  test: {
    css: true,
  },
});
