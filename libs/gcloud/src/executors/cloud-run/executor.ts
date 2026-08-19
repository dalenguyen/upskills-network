import { logger } from '@nx/devkit';

import {
  buildCommand,
  execCommand,
  objectToArray,
  shellQuote,
} from '../../utils';
import { CloudRunExecutorSchema } from './executor-options.model';
import type { CloudRunExecutorOptions } from './schema';

export default async function runExecutor(options: CloudRunExecutorOptions) {
  let parsed: ReturnType<typeof CloudRunExecutorSchema.parse>;
  try {
    parsed = CloudRunExecutorSchema.parse(options);
  } catch (error: unknown) {
    logger.error(error);
    return { success: false };
  }

  const imageTag = getImageTag();
  const imageWithTag = `${parsed.containerImageName}:${imageTag}`;

  const failures = parsed.regions
    .map((region) => generateDeployCommand(parsed, imageWithTag, region))
    .map((cmd) => execCommand(cmd))
    .filter((result) => !result.success);

  return { success: failures.length === 0 };
}

export function generateDeployCommand(
  options: ReturnType<typeof CloudRunExecutorSchema.parse>,
  imageWithTag: string,
  region: string,
): string {
  const image = `${options.containerRegistry}/${imageWithTag}`;
  const envVarArray = objectToArray(options.envVars);
  const setEnvVars = `^++^${envVarArray.join('++')}`;
  const secrets = options.secrets.join(',');

  if (options.allowUnauthenticated) {
    logger.warn(
      `--allow-unauthenticated enabled for ${options.serviceName}. Service will be public.`,
    );
  }

  return buildCommand([
    `gcloud run deploy ${options.serviceName}`,
    `--image=${image}`,
    '--platform=managed',
    `--project=${options.project}`,
    `--region=${region}`,

    options.ingress && `--ingress=${options.ingress}`,
    options.port !== undefined && `--port=${options.port}`,
    options.cpu !== undefined && `--cpu=${options.cpu}`,
    options.memory && `--memory=${options.memory}`,
    options.minInstances !== undefined &&
      `--min-instances=${options.minInstances}`,
    options.maxInstances !== undefined &&
      `--max-instances=${options.maxInstances}`,
    options.concurrency !== undefined && `--concurrency=${options.concurrency}`,
    options.timeout !== undefined && `--timeout=${options.timeout}`,

    envVarArray.length > 0 && `--set-env-vars=${shellQuote(setEnvVars)}`,
    secrets.length > 0 && `--set-secrets=${secrets}`,

    options.serviceAccount && `--service-account=${options.serviceAccount}`,
    options.allowUnauthenticated && '--allow-unauthenticated',
    !options.allowUnauthenticated && '--no-allow-unauthenticated',
  ]);
}

/**
 * Must stay in lockstep with the tag `deploy-docker` builds and pushes, which
 * is `${BUILD_NUMBER:-latest}` (see each app's project.json). If the two
 * fall back differently, the image that gets pushed and the image Cloud Run is
 * asked to run are different tags, and the deploy dies with "Image ... not
 * found" after the build and push have already succeeded.
 *
 * This previously fell back to `<date>.local-<git user>`, which no build step
 * ever produced — so every deploy without BUILD_NUMBER set failed. There is no
 * deploy step in CI, so that was every deploy.
 */
function getImageTag(): string {
  return process.env['BUILD_NUMBER'] || 'latest';
}
