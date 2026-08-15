/// <reference types="vitest" />

import analog from '@analogjs/platform';
import tailwindcss from '@tailwindcss/vite';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const workspaceRoot = resolve(__dirname, '../..');

/**
 * `nxViteTsPaths` teaches Vite about the `@upskills/*` aliases, but Nitro runs
 * its own Rollup pass that never sees Vite's plugins. Left alone it treats each
 * alias as a bare package specifier and externalises it, so the server chunks
 * ship `import ... from '@upskills/auth'` — which then dies with
 * ERR_MODULE_NOT_FOUND on Cloud Run, where the runner image carries only
 * `dist/apps/web` and no `node_modules`. Feeding the same paths to Nitro makes
 * it resolve them to workspace source and bundle them in.
 *
 * Read from `tsconfig.base.json` rather than hardcoded so a new lib can never
 * be aliased for the browser but missing from the server bundle.
 */
const workspaceAliases: Record<string, string> = Object.fromEntries(
  Object.entries(
    JSON.parse(
      readFileSync(resolve(workspaceRoot, 'tsconfig.base.json'), 'utf-8'),
    ).compilerOptions.paths as Record<string, string[]>,
  ).map(([alias, [target]]) => [alias, resolve(workspaceRoot, target)]),
);

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
    plugins: [
      tailwindcss(),
      analog({
        nitro: {
          alias: workspaceAliases,
          externals: { inline: [/^@upskills\//] },
        },
      }),
      nxViteTsPaths(),
    ],
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
