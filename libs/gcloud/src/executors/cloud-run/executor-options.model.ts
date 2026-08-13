import { z } from 'zod';

const availableRegions: [string, ...string[]] = ['us-central1'];
const availableMemory: [string, ...string[]] = [
  '256Mi',
  '512Mi',
  '1Gi',
  '2Gi',
  '4Gi',
];
const availableIngress = [
  'internal',
  'all',
  'internal-and-cloud-load-balancing',
] as const;

export const CloudRunExecutorSchema = z
  .object({
    containerRegistry: z
      .string()
      .optional()
      .default('us-central1-docker.pkg.dev/upskills-network/upskills'),
    containerImageName: z.string().optional(),
    project: z.string().min(1),
    serviceName: z.string().min(1),
    regions: z.array(z.enum(availableRegions)).default(['us-central1']),

    memory: z.enum(availableMemory).default('512Mi'),
    cpu: z.number().int().min(1).default(1),
    minInstances: z.number().int().min(0).optional(),
    maxInstances: z.number().int().min(1).optional(),
    concurrency: z.number().int().min(1).optional(),
    timeout: z.number().int().min(1).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    ingress: z.enum(availableIngress).optional(),

    serviceAccount: z.string().optional(),
    envVars: z.record(z.string(), z.string()).default({}),
    secrets: z.array(z.string()).default([]),
    allowUnauthenticated: z.boolean().default(false),
  })
  .transform((data) => ({
    ...data,
    containerImageName: data.containerImageName ?? data.serviceName,
    serviceAccount:
      data.serviceAccount ??
      `${data.serviceName}-runner@${data.project}.iam.gserviceaccount.com`,
  }));
