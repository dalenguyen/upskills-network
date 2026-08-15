import { beforeEach, describe, expect, it, vi } from 'vitest';

import runExecutor from './executor';

// Partial mock: keep buildCommand + objectToArray real so command assertions work
vi.mock('../../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils')>();
  return {
    ...actual,
    execCommand: vi.fn().mockReturnValue({ success: true, output: '' }),
  };
});

vi.mock('@nx/devkit', () => ({
  logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import * as utils from '../../utils';

const baseOptions = {
  project: 'upskills-network',
  serviceName: 'upskills-web',
};

const lastCommand = () =>
  vi.mocked(utils.execCommand).mock.calls[0][0] as string;

describe('runExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(utils.execCommand).mockReturnValue({ success: true, output: '' });
    // deterministic tag for assertions
    process.env['BUILD_NUMBER'] = 'test-build';
  });

  it('returns success when the gcloud command succeeds', async () => {
    const result = await runExecutor(baseOptions);
    expect(result.success).toBe(true);
  });

  it('tags the image with BUILD_NUMBER when it is set', async () => {
    process.env['BUILD_NUMBER'] = 'v1.2.3';
    await runExecutor(baseOptions);
    expect(lastCommand()).toContain('/upskills-web:v1.2.3');
  });

  // `deploy-docker` pushes `${BUILD_NUMBER:-latest}`, so the executor has to
  // fall back to the same `latest` or it asks Cloud Run for a tag that was
  // never pushed. Deploys only ever run locally, where BUILD_NUMBER is unset,
  // so this is the path that actually matters.
  it('falls back to the latest tag when BUILD_NUMBER is unset', async () => {
    delete process.env['BUILD_NUMBER'];
    await runExecutor(baseOptions);
    expect(lastCommand()).toContain('/upskills-web:latest');
  });

  it('calls execCommand once per region', async () => {
    await runExecutor(baseOptions);
    expect(utils.execCommand).toHaveBeenCalledTimes(1);
  });

  it('includes --image with registry, image name, and tag', async () => {
    await runExecutor(baseOptions);
    expect(lastCommand()).toContain(
      '--image=us-central1-docker.pkg.dev/upskills-network/upskills/upskills-web:test-build',
    );
  });

  it('deploys to us-central1 by default', async () => {
    await runExecutor(baseOptions);
    expect(lastCommand()).toContain('--region=us-central1');
  });

  it('includes --no-allow-unauthenticated by default', async () => {
    await runExecutor(baseOptions);
    expect(lastCommand()).toContain('--no-allow-unauthenticated');
  });

  it('includes --allow-unauthenticated for public services', async () => {
    await runExecutor({ ...baseOptions, allowUnauthenticated: true });
    expect(lastCommand()).toContain('--allow-unauthenticated');
    expect(lastCommand()).not.toContain('--no-allow-unauthenticated');
  });

  it('includes --ingress when set', async () => {
    await runExecutor({ ...baseOptions, ingress: 'internal' });
    expect(lastCommand()).toContain('--ingress=internal');
  });

  it('includes --port when set', async () => {
    await runExecutor({ ...baseOptions, port: 8080 });
    expect(lastCommand()).toContain('--port=8080');
  });

  it('includes --set-secrets when secrets are provided', async () => {
    await runExecutor({
      ...baseOptions,
      secrets: ['RESEND_API_KEY=RESEND_API_KEY:latest', 'FOO=FOO:latest'],
    });
    expect(lastCommand()).toContain(
      '--set-secrets=RESEND_API_KEY=RESEND_API_KEY:latest,FOO=FOO:latest',
    );
  });

  it('includes --set-env-vars when env vars are provided', async () => {
    await runExecutor({
      ...baseOptions,
      envVars: { NODE_ENV: 'production', GCP_PROJECT_ID: 'upskills-network' },
    });
    expect(lastCommand()).toContain(
      '--set-env-vars=^++^NODE_ENV=production++GCP_PROJECT_ID=upskills-network',
    );
  });

  it('returns failure when the gcloud command fails', async () => {
    vi.mocked(utils.execCommand).mockReturnValue({
      success: false,
      output: 'error',
    });
    const result = await runExecutor(baseOptions);
    expect(result.success).toBe(false);
  });

  it('returns failure on invalid options', async () => {
    const result = await runExecutor({
      project: '',
      serviceName: '',
    } as never);
    expect(result.success).toBe(false);
  });
});
