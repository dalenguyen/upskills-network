/// <reference types="vitest" />

import analog from '@analogjs/platform';
import tailwindcss from '@tailwindcss/vite';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig(() => {
  return {
    root: __dirname,
    cacheDir: `../../node_modules/.vite`,
    resolve: {
      alias: {
        // Analog server routes import h3 v1. Pin the resolution so a hoisted
        // h3 v2 (which dropped `createEvent`) can never win in server tests.
        h3: resolve(
          __dirname,
          '../../node_modules/.pnpm/h3@1.15.11/node_modules/h3/dist/index.mjs',
        ),
      },
    },
    build: {
      outDir: '../../dist/apps/web/client',
      reportCompressedSize: true,
      target: ['es2020'],
    },
    server: {
      fs: {
        allow: ['.'],
      },
    },
    plugins: [tailwindcss(), analog(), nxViteTsPaths()],
    test: {
      globals: true,
      setupFiles: ['src/test-setup.ts'],
      reporters: ['default'],
      // Vitest 4 removed `environmentMatchGlobs`; projects are the replacement.
      // Server-route specs need the node environment, everything else jsdom.
      projects: [
        {
          extends: true,
          test: {
            name: 'web',
            environment: 'jsdom',
            include: ['**/*.spec.ts'],
            exclude: ['**/node_modules/**', 'src/server/**'],
          },
        },
        {
          extends: true,
          test: {
            name: 'web-server',
            environment: 'node',
            include: ['src/server/**/*.spec.ts'],
          },
        },
      ],
    },
  };
});
