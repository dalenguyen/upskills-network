import { describe, expect, it } from 'vitest';

import { buildCommand } from './build-command';

describe('buildCommand', () => {
  it('joins non-falsy parts with spaces', () => {
    expect(buildCommand(['gcloud run deploy foo', '--region=us-central1'])).toBe(
      'gcloud run deploy foo --region=us-central1',
    );
  });

  it('filters out false values', () => {
    expect(
      buildCommand(['gcloud run deploy foo', false, '--region=us-central1']),
    ).toBe('gcloud run deploy foo --region=us-central1');
  });

  it('filters out undefined values', () => {
    expect(
      buildCommand(['gcloud run deploy foo', undefined, '--region=us-central1']),
    ).toBe('gcloud run deploy foo --region=us-central1');
  });
});
