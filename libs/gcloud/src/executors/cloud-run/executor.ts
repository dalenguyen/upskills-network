import { logger } from '@nx/devkit';

import { buildCommand, execCommand, objectToArray } from '../../utils';
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
    options.concurrency !== undefined &&
      `--concurrency=${options.concurrency}`,
    options.timeout !== undefined && `--timeout=${options.timeout}`,

    envVarArray.length > 0 && `--set-env-vars=${setEnvVars}`,
    secrets.length > 0 && `--set-secrets=${secrets}`,

    options.serviceAccount && `--service-account=${options.serviceAccount}`,
    options.allowUnauthenticated && '--allow-unauthenticated',
    !options.allowUnauthenticated && '--no-allow-unauthenticated',
  ]);
}

function getImageTag(): string {
  const buildNumber = process.env['BUILD_NUMBER'];
  if (buildNumber) return buildNumber;

  const gitResult = execCommand('git config --global user.name', {
    silent: true,
  });
  const name = gitResult.success
    ? gitResult.output.replace(/[\s\n]/g, '').toLowerCase()
    : 'local';
  const date = new Date().toISOString().substring(0, 10).replace(/-/g, '');
  return `${date}.local-${name}`;
}
