import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import os from 'os';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    maxWorkers: 4,
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // integration/** is the dockerized Playwright suite (run via
    // `npm run test:integration`); examples/** is untracked sample code; and
    // repos/** holds sibling checkouts with their own runners. node_modules
    // must be globbed at any depth or the nested repos/*/node_modules trees
    // get collected too.
    // scripts/lite/smoke/** is the Playwright smoke for the static Lite export.
    exclude: ['src/components/ui/__tests__/dialog-surface.test.tsx', 'src/components/ui/__tests__/dialog-shadow-margin.test.tsx', 'integration/**', 'examples/**', 'repos/**', '**/node_modules/**', '.next/**', 'out/**', 'scripts/lite/smoke/**', 'scripts/perf-guard/**', 'scripts/a11y-guard/**', 'scripts/boot-skeleton-guard/**'],
    // The default node_modules/.vitest-cache sits inside the tree Turbopack
    // watches, so every test run made a running `next dev` rebuild and reload
    // the open page about once a second.
    fsModuleCachePath: path.join(os.tmpdir(), 'bulwark-vitest-cache'),
  },
  resolve: {
    alias: {
      '@platform':path.resolve(__dirname,'./src/platform'),
      '@': path.resolve(__dirname, './src'),
    },
  },
});
