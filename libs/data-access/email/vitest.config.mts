import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

const workspaceRoot = resolve(__dirname, '../../..');

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../../node_modules/.vite/libs/data-access/email',
  plugins: [
    tsconfigPaths({ root: workspaceRoot, projects: ['tsconfig.base.json'] }),
  ],
  test: {
    name: 'data-access-email',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../coverage/libs/data-access/email',
      provider: 'v8' as const,
    },
  },
}));
