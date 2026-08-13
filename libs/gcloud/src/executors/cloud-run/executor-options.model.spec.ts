import { describe, expect, it } from 'vitest';

import { CloudRunExecutorSchema } from './executor-options.model';

describe('CloudRunExecutorSchema', () => {
  const base = {
    project: 'upskills-network',
    serviceName: 'upskills-web',
  };

  it('parses with required fields and applies defaults', () => {
    const result = CloudRunExecutorSchema.parse(base);
    expect(result.containerRegistry).toBe(
      'us-central1-docker.pkg.dev/upskills-network/upskills',
    );
    expect(result.containerImageName).toBe('upskills-web');
    expect(result.regions).toEqual(['us-central1']);
    expect(result.memory).toBe('512Mi');
    expect(result.cpu).toBe(1);
    expect(result.allowUnauthenticated).toBe(false);
    expect(result.envVars).toEqual({});
    expect(result.secrets).toEqual([]);
  });

  it('derives serviceAccount from serviceName and project', () => {
    const result = CloudRunExecutorSchema.parse(base);
    expect(result.serviceAccount).toBe(
      'upskills-web-runner@upskills-network.iam.gserviceaccount.com',
    );
  });

  it('accepts an explicit containerImageName', () => {
    const result = CloudRunExecutorSchema.parse({
      ...base,
      containerImageName: 'custom-image',
    });
    expect(result.containerImageName).toBe('custom-image');
  });

  it('fails when project is missing', () => {
    expect(() =>
      CloudRunExecutorSchema.parse({ serviceName: 'upskills-web' }),
    ).toThrow();
  });

  it('fails on an invalid memory value', () => {
    expect(() =>
      CloudRunExecutorSchema.parse({ ...base, memory: '999Mi' }),
    ).toThrow();
  });

  it('fails on an invalid ingress value', () => {
    expect(() =>
      CloudRunExecutorSchema.parse({ ...base, ingress: 'invalid' }),
    ).toThrow();
  });
});
