import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearFirestore,
  EMULATOR_HOST_ENV,
  EMULATOR_PROJECT_ID,
} from '../testing/emulator';
import { getDb } from './db';

describe('getDb', () => {
  beforeEach(clearFirestore);

  it('memoizes one client per process', () => {
    expect(getDb()).toBe(getDb());
  });

  it('talks to the emulator purely through the environment', async () => {
    // No emulator-specific argument is passed anywhere in `getDb()`: this env
    // var is the entire difference between test and Cloud Run.
    expect(process.env[EMULATOR_HOST_ENV]).toBeTruthy();

    // A real round trip, with no credentials configured — proof that reaching
    // the emulator needs neither ADC nor a key file.
    const ref = getDb().collection('smokeTest').doc('ping');
    await ref.set({ ok: true });

    expect((await ref.get()).data()).toEqual({ ok: true });
  });

  it('writes into the demo project, so nothing can reach real GCP', async () => {
    const ref = getDb().collection('smokeTest').doc('project-check');
    await ref.set({ ok: true });

    // `clearFirestore()` wipes exactly EMULATOR_PROJECT_ID. If the client were
    // pointed at any other project, the doc would survive.
    expect(EMULATOR_PROJECT_ID).toMatch(/^demo-/);
    await clearFirestore();

    expect((await ref.get()).exists).toBe(false);
  });

  it('ignores undefined properties so optional model fields can be spread', async () => {
    const ref = getDb().collection('smokeTest').doc('optional-fields');
    await ref.set({ present: 1, absent: undefined });

    expect((await ref.get()).data()).toEqual({ present: 1 });
  });
});
