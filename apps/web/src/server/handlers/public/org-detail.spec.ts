import { describe, expect, it, vi } from 'vitest';
import { createTestEvent } from '../../testing/h3-event';
import { fakeEvent, fakeOrg } from '../../testing/public-fixtures';
import { createOrgDetailHandler, type OrgDetailDeps } from './org-detail';

/** `GET /api/v1/orgs/:orgSlug` — the public organizer page. */

function deps(overrides: Partial<OrgDetailDeps> = {}): OrgDetailDeps {
  return {
    getOrgBySlug: vi.fn(async () => fakeOrg()),
    listPublishedOrgEvents: vi.fn(async () => ({
      events: [fakeEvent()],
      nextCursor: null,
    })),
    ...overrides,
  };
}

function request(orgSlug = 'upskills-toronto', query = '') {
  return createTestEvent({
    method: 'GET',
    url: `/api/v1/orgs/${orgSlug}${query}`,
    params: { orgSlug },
  }).event;
}

describe('GET /api/v1/orgs/:orgSlug', () => {
  it('returns the org profile and its published events', async () => {
    const result = await createOrgDetailHandler(deps())(request());

    expect(result).toMatchObject({
      org: { orgId: 'org-1', name: 'Upskills Toronto' },
      events: [expect.objectContaining({ eventId: 'evt-1' })],
      nextCursor: null,
    });
  });

  it('never ships the staff roster to an anonymous visitor', async () => {
    const d = deps({
      getOrgBySlug: vi.fn(async () =>
        fakeOrg({ memberUids: ['uid-1', 'uid-secret'] }),
      ),
    });

    const result = await createOrgDetailHandler(d)(request());

    expect(JSON.stringify(result)).not.toContain('uid-secret');
  });

  it('lists events for the resolved org id, not the slug', async () => {
    const listPublishedOrgEvents = vi.fn(async () => ({
      events: [],
      nextCursor: null,
    }));

    await createOrgDetailHandler(
      deps({
        getOrgBySlug: vi.fn(async () => fakeOrg({ orgId: 'org-42' })),
        listPublishedOrgEvents,
      }),
    )(request('some-slug'));

    expect(listPublishedOrgEvents).toHaveBeenCalledWith('org-42', {
      cursor: null,
    });
  });

  it('answers 200 with no events for an org that has published nothing', async () => {
    const d = deps({
      listPublishedOrgEvents: vi.fn(async () => ({
        events: [],
        nextCursor: null,
      })),
    });

    // An organizer is not a secret — their slug is on every event they have
    // ever published, so an empty schedule must not break a bookmarked link.
    await expect(createOrgDetailHandler(d)(request())).resolves.toMatchObject({
      org: { slug: 'upskills-toronto' },
      events: [],
    });
  });

  it('answers 404 for an unknown org slug', async () => {
    const d = deps({ getOrgBySlug: vi.fn(async () => null) });

    await expect(
      createOrgDetailHandler(d)(request('nope')),
    ).rejects.toMatchObject({
      statusCode: 404,
      data: { error: 'org-not-found' },
    });
  });

  it('pages the org listing with a cursor', async () => {
    const listPublishedOrgEvents = vi.fn(async () => ({
      events: [fakeEvent()],
      nextCursor: 'cursor-2',
    }));

    const result = await createOrgDetailHandler(
      deps({ listPublishedOrgEvents }),
    )(request('upskills-toronto', '?cursor=cursor-1'));

    expect(listPublishedOrgEvents).toHaveBeenCalledWith('org-1', {
      cursor: 'cursor-1',
    });
    expect(result).toMatchObject({ nextCursor: 'cursor-2' });
  });

  it('answers 400 for a malformed cursor, same code as the browse route', async () => {
    const d = deps({
      listPublishedOrgEvents: vi.fn(async () => {
        throw new Error('Invalid cursor');
      }),
    });

    await expect(
      createOrgDetailHandler(d)(request('upskills-toronto', '?cursor=bad')),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { error: 'invalid-cursor' },
    });
  });

  it('lets an unexpected read failure surface as a 500', async () => {
    const bug = new TypeError('firestore exploded');
    const d = deps({
      getOrgBySlug: vi.fn(async () => {
        throw bug;
      }),
    });

    await expect(createOrgDetailHandler(d)(request())).rejects.toBe(bug);
  });
});
