import { createError, isError } from 'h3';
import { describe, expect, it } from 'vitest';
import {
  fakeForbiddenError,
  fakeInvalidSessionError,
  fakeInvalidSlugError,
  fakeLastOrgAdminError,
  fakeOrgNotFoundError,
  fakeSlugTakenError,
} from '../testing/fakes';
import { toHttpError } from './http-error';

/**
 * The status mapping, on its own — including the failures that must *not* be
 * mapped. Recognizing too much here is how a bug turns into "every user must
 * sign in again", which is the expensive kind of outage.
 */
describe('toHttpError', () => {
  it('maps InvalidSessionError to 401 and carries its reason', () => {
    const mapped = toHttpError(fakeInvalidSessionError('stale-sign-in'));

    expect(mapped).toMatchObject({
      statusCode: 401,
      data: { error: 'invalid-session', reason: 'stale-sign-in' },
    });
  });

  it('maps ForbiddenError to 403 and drops its message', () => {
    const mapped = toHttpError(
      fakeForbiddenError('One of [admin] in org "org-1" is required.'),
    );

    expect(mapped).toMatchObject({
      statusCode: 403,
      data: { error: 'forbidden' },
    });
    expect((mapped as Error).message).not.toContain('org-1');
  });

  it('maps SlugTakenError to 409 without echoing the holder', () => {
    const mapped = toHttpError(fakeSlugTakenError('upskills-toronto'));

    expect(mapped).toMatchObject({
      statusCode: 409,
      data: { error: 'slug-taken' },
    });
  });

  it('maps InvalidSlugError to 400', () => {
    const mapped = toHttpError(fakeInvalidSlugError('Not A Slug'));

    expect(mapped).toMatchObject({
      statusCode: 400,
      data: { error: 'invalid-slug' },
    });
  });

  it('maps LastOrgAdminError to 409', () => {
    const mapped = toHttpError(fakeLastOrgAdminError('org-1', 'uid-1'));

    expect(mapped).toMatchObject({
      statusCode: 409,
      data: { error: 'last-org-admin' },
    });
  });

  it('maps OrgNotFoundError to 404', () => {
    const mapped = toHttpError(fakeOrgNotFoundError('org-missing'));

    expect(mapped).toMatchObject({
      statusCode: 404,
      data: { error: 'org-not-found' },
    });
  });

  it('passes an error a handler raised itself through unchanged', () => {
    const raised = createError({ statusCode: 400, data: { error: 'x' } });

    expect(toHttpError(raised)).toBe(raised);
  });

  it('does not turn an unrelated error carrying status 401 into a 401', () => {
    // Only the auth lib's own type is a verdict on the credential. A 401 from
    // some other client (an outbound HTTP call, say) is our problem, not the
    // caller's, and must not sign them out.
    const upstream = Object.assign(new Error('upstream said no'), {
      name: 'FetchError',
      status: 401,
    });

    expect(toHttpError(upstream)).toBe(upstream);
    expect(isError(toHttpError(upstream))).toBe(false);
  });

  it('leaves an ordinary failure alone so it becomes a 500', () => {
    const bug = new TypeError('auth is not a function');

    expect(toHttpError(bug)).toBe(bug);
  });

  it('leaves a non-Error throw alone', () => {
    expect(toHttpError('nope')).toBe('nope');
  });
});
