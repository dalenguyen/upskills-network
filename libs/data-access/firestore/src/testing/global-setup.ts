import { spawn, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  EMULATOR_PROJECT_ID,
  FIREBASE_CONFIG_ENV,
  emulatorHost,
  isEmulatorReady,
} from './emulator';

/**
 * Vitest global setup: bring up the Firestore emulator once per test run and
 * make sure it is gone again when the run ends.
 *
 * `vitest.config.mts` has already exported `FIRESTORE_EMULATOR_HOST` and
 * `GCLOUD_PROJECT` into this process and into every worker, so the code under
 * test needs no emulator-specific branch — see `getDb()`.
 */

/** How long to wait for the emulator to answer before giving up. */
const START_TIMEOUT_MS = 90_000;

/** How long to wait for a graceful shutdown before escalating to SIGKILL. */
const STOP_TIMEOUT_MS = 10_000;

const POLL_INTERVAL_MS = 250;

/** Only set when *this* process started the emulator, and so must stop it. */
let emulator: ChildProcess | undefined;

export async function setup(): Promise<void> {
  const host = emulatorHost();

  // Someone already has one running (a dev's `firebase emulators:start`, or a
  // CI service). Reuse it rather than fighting over the port — and, since we
  // did not start it, leave it running at teardown.
  if (await isEmulatorStablyReady(host)) {
    return;
  }

  // Either nothing is there, or something is on the port that is not a healthy
  // emulator — most often one shutting down from a previous run, which answers
  // a single probe and then dies mid-test. Wait for it to let go before we bind.
  await waitForPortToClose();

  const configPath = process.env[FIREBASE_CONFIG_ENV];
  if (!configPath) {
    throw new Error(
      `${FIREBASE_CONFIG_ENV} is not set; check vitest.config.mts`,
    );
  }

  const output: string[] = [];
  const child = spawn(
    'firebase',
    [
      'emulators:start',
      '--only',
      'firestore',
      '--project',
      EMULATOR_PROJECT_ID,
      '--config',
      configPath,
    ],
    {
      cwd: dirname(configPath),
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group, so teardown can signal the CLI *and* the Java
      // process it spawns with a single kill.
      detached: true,
    },
  );

  emulator = child;
  child.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()));

  let spawnError: Error | undefined;
  let exited = false;
  child.on('error', (error) => {
    spawnError = error;
  });
  child.on('exit', () => {
    exited = true;
  });

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (spawnError) {
      throw new Error(
        `Could not run the "firebase" CLI (${spawnError.message}). Install it with "pnpm dlx firebase-tools" or "npm i -g firebase-tools".`,
      );
    }

    if (exited) {
      throw new Error(
        `The Firestore emulator exited before it was ready:\n${output.join('')}`,
      );
    }

    if (await isEmulatorReady(host)) {
      return;
    }

    await delay(POLL_INTERVAL_MS);
  }

  await stopEmulator();
  throw new Error(
    `The Firestore emulator did not become ready on ${host} within ${START_TIMEOUT_MS}ms:\n${output.join('')}`,
  );
}

export async function teardown(): Promise<void> {
  await stopEmulator();
}

/**
 * `true` only when the emulator answers twice, a beat apart.
 *
 * A single probe is not enough to justify reusing someone else's emulator: one
 * that is shutting down still answers for a moment, and reusing it means the
 * whole run dies partway through with connection errors. Two probes separated
 * by a short gap reject that case, which is the flake this harness hit when a
 * previous run's emulator overlapped the next run's startup.
 */
async function isEmulatorStablyReady(host: string): Promise<boolean> {
  if (!(await isEmulatorReady(host))) {
    return false;
  }

  await delay(POLL_INTERVAL_MS);

  return isEmulatorReady(host);
}

async function stopEmulator(): Promise<void> {
  const child = emulator;
  emulator = undefined;

  if (!child?.pid || child.exitCode !== null) {
    return;
  }

  const exited = new Promise<void>((resolve) => child.once('exit', resolve));

  // Negative pid = the whole process group: the CLI and its Java child.
  killGroup(child.pid, 'SIGTERM');

  const timedOut = await Promise.race([
    exited.then(() => false),
    delay(STOP_TIMEOUT_MS, true),
  ]);

  if (timedOut) {
    killGroup(child.pid, 'SIGKILL');
    await exited;
  }

  // The Java process releases the port slightly after the CLI returns. Waiting
  // for the port to actually go quiet is what makes two runs back to back
  // reliable — otherwise the next run either finds a dying emulator "ready" or
  // fails to bind the port.
  await waitForPortToClose();
}

async function waitForPortToClose(): Promise<void> {
  const deadline = Date.now() + STOP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (!(await isPortOpen(emulatorHost()))) {
      return;
    }

    await delay(POLL_INTERVAL_MS);
  }
}

/** `true` while anything still holds the port — HTTP-level readiness is not
 * enough here: a shutting-down emulator stops answering before it lets go of
 * the socket. */
function isPortOpen(host: string): Promise<boolean> {
  const [hostname, port] = host.split(':');

  return new Promise((resolve) => {
    const socket = connect({ host: hostname, port: Number(port) });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };

    socket.setTimeout(1000);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Already gone — nothing to clean up.
  }
}
