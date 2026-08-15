import { join, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

const workspaceRoot = resolve(__dirname, '../../..');
import {
  EMULATOR_HOST_ENV,
  EMULATOR_PROJECT_ID,
  FIREBASE_CONFIG_ENV,
  readEmulatorHost,
} from './src/testing/emulator';

const firebaseJsonPath = join(__dirname, '../../../firebase.json');
const emulatorHost = readEmulatorHost(firebaseJsonPath);

/**
 * The emulator settings the Admin SDK reads on its own. They are exported into
 * this process as well as into the workers, because the global setup that
 * starts the emulator runs here, before any worker exists.
 */
const emulatorEnv = {
  [EMULATOR_HOST_ENV]: emulatorHost,
  GCLOUD_PROJECT: EMULATOR_PROJECT_ID,
  GOOGLE_CLOUD_PROJECT: EMULATOR_PROJECT_ID,
  [FIREBASE_CONFIG_ENV]: firebaseJsonPath,
};
Object.assign(process.env, emulatorEnv);

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../../node_modules/.vite/libs/data-access/firestore',
  plugins: [
    tsconfigPaths({ root: workspaceRoot, projects: ['tsconfig.base.json'] }),
  ],
  test: {
    name: 'data-access-firestore',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    env: emulatorEnv,
    globalSetup: ['./src/testing/global-setup.ts'],
    // Every test file talks to the same emulator database and wipes it in
    // `beforeEach`, so files must not overlap in time.
    fileParallelism: false,
    coverage: {
      reportsDirectory: '../../../coverage/libs/data-access/firestore',
      provider: 'v8' as const,
    },
  },
}));
