import type { Organizer, PlatformRole, User } from '@upskills/models';
import { FakeAuth } from '../testing/fake-auth';
import { fakeEvent } from '../testing/fake-event';
import { createGuards, ForbiddenError, type GuardReads } from './guards';
import {
  InvalidSessionError,
  SESSION_COOKIE_NAME,
  createSessionCookie,
  revokeSessions,
} from './session-cookie';

/** `@upskills/models` declares `Timestamp` structurally; this satisfies it. */
const NOW = { toDate: () => new Date(0), toMillis: () => 0 };

/**
 * The reads a guard makes, over an in-memory store. The guards contain no query
 * logic of their own — they call `getUser`/`getOrg` and branch on the answer —
 * so what needs testing is the branching, and the emulator would only make it
 * slower. `guards.ts` imports the real helpers into `PRODUCTION_READS`, which
 * is what keeps this shape honest at compile time.
 */
class FakeReads implements GuardReads {
  readonly users = new Map<string, User>();
  readonly orgs = new Map<string, Organizer>();
  readonly calls: string[] = [];

  user(uid: string, role: PlatformRole): this {
    this.users.set(uid, {
      uid,
      email: `${uid}@example.com`,
      role,
      orgIds: [],
      createdAt: NOW,
    });

    return this;
  }

  org(orgId: string, members: Organizer['members']): this {
    this.orgs.set(orgId, {
      orgId,
      name: orgId,
      slug: orgId,
      createdBy: 'uid-owner',
      members,
      memberUids: Object.keys(members),
      createdAt: NOW,
    });

    return this;
  }

  async getUser(uid: string): Promise<User | null> {
    this.calls.push('getUser');
    return this.users.get(uid) ?? null;
  }

  async getOrg(orgId: string): Promise<Organizer | null> {
    this.calls.push('getOrg');
    return this.orgs.get(orgId) ?? null;
  }
}

async function signIn(auth: FakeAuth, uid: string): Promise<string> {
  auth.seedIdToken(`token-${uid}`, { uid, email: `${uid}@example.com` });
  const { value } = await createSessionCookie(`token-${uid}`, { auth });

  return value;
}

/** A signed-in caller's request, ready to hand to a guard. */
async function requestFrom(auth: FakeAuth, uid: string) {
  return fakeEvent({ [SESSION_COOKIE_NAME]: await signIn(auth, uid) });
}

function member(role: Organizer['members'][string]['role']) {
  return { role, addedAt: NOW };
}

/**
 * The refusal a guard threw. Fails the test if the guard let the caller
 * through, so a comparison of two refusals can never quietly compare nothing.
 */
async function refusal(guard: Promise<unknown>): Promise<ForbiddenError> {
  return guard.then(
    () => {
      throw new Error('expected the guard to refuse, but it passed');
    },
    (thrown: unknown) => thrown as ForbiddenError,
  );
}

describe('requireAuth', () => {
  it('answers the uid and the platform role', async () => {
    const auth = new FakeAuth();
    const reads = new FakeReads().user('uid-1', 'user');
    const { requireAuth } = createGuards({ auth, reads });

    const context = await requireAuth(await requestFrom(auth, 'uid-1'));

    expect(context.uid).toBe('uid-1');
    expect(context.role).toBe('user');
    expect(context.session.uid).toBe('uid-1');
  });

  it('rejects a request with no cookie as 401, without touching Firestore', async () => {
    const auth = new FakeAuth();
    const reads = new FakeReads();
    const { requireAuth } = createGuards({ auth, reads });

    const error = await requireAuth(fakeEvent()).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(InvalidSessionError);
    expect(error).toMatchObject({ reason: 'missing', status: 401 });
    expect(reads.calls).toEqual([]);
  });

  it('rejects an expired cookie as 401', async () => {
    const auth = new FakeAuth();
    const reads = new FakeReads().user('uid-1', 'user');
    const { requireAuth } = createGuards({ auth, reads });
    const event = await requestFrom(auth, 'uid-1');

    auth.now = () => Date.now() + 6 * 24 * 60 * 60 * 1000;

    await expect(requireAuth(event)).rejects.toMatchObject({
      reason: 'expired',
      status: 401,
    });
  });

  it('rejects a revoked cookie as 401', async () => {
    const auth = new FakeAuth();
    const reads = new FakeReads().user('uid-1', 'user');
    const { requireAuth } = createGuards({ auth, reads });
    const event = await requestFrom(auth, 'uid-1');

    auth.now = () => Date.now() + 1000;
    await revokeSessions('uid-1', { auth });

    await expect(requireAuth(event)).rejects.toMatchObject({
      reason: 'revoked',
      status: 401,
    });
  });

  it('rejects a garbage cookie as 401', async () => {
    const auth = new FakeAuth();
    const { requireAuth } = createGuards({ auth, reads: new FakeReads() });

    await expect(
      requireAuth(fakeEvent({ [SESSION_COOKIE_NAME]: 'not-a-cookie' })),
    ).rejects.toMatchObject({ reason: 'malformed', status: 401 });
  });

  it('treats an account with no user document as an ordinary user', async () => {
    const auth = new FakeAuth();
    const reads = new FakeReads(); // no document for uid-1
    const { requireAuth } = createGuards({ auth, reads });

    const context = await requireAuth(await requestFrom(auth, 'uid-1'));

    expect(context.role).toBe('user');
  });

  // The whole reason the guards read Firestore rather than the cookie.
  it('reads the role from Firestore, not from the cookie claim', async () => {
    const auth = new FakeAuth();
    const reads = new FakeReads().user('uid-1', 'user');
    const { requireAuth } = createGuards({ auth, reads });

    // A cookie minted while the account still carried the admin claim — the
    // demotion landed in Firestore afterwards, which is exactly the window
    // `admin-claim.ts` describes.
    auth.seedIdToken('token', { uid: 'uid-1' });
    auth.account('uid-1').customClaims = { admin: true };
    const { value } = await createSessionCookie('token', { auth });
    const event = fakeEvent({ [SESSION_COOKIE_NAME]: value });

    const context = await requireAuth(event);

    expect(context.session.admin).toBe(true); // the stale claim is still there
    expect(context.role).toBe('user'); // and it does not decide anything
  });

  it('honors a promotion that the cookie claim has not caught up with', async () => {
    const auth = new FakeAuth();
    const reads = new FakeReads().user('uid-1', 'admin');
    const { requireAuth, requireAdmin } = createGuards({ auth, reads });
    const event = await requestFrom(auth, 'uid-1');

    expect((await requireAuth(event)).session.admin).toBe(false);
    await expect(requireAdmin(event)).resolves.toMatchObject({ role: 'admin' });
  });
});

describe('requireAdmin', () => {
  it('passes a platform admin', async () => {
    const auth = new FakeAuth();
    const reads = new FakeReads().user('uid-1', 'admin');
    const { requireAdmin } = createGuards({ auth, reads });

    await expect(
      requireAdmin(await requestFrom(auth, 'uid-1')),
    ).resolves.toMatchObject({ uid: 'uid-1', role: 'admin' });
  });

  it('refuses an ordinary user with 403, not 401', async () => {
    const auth = new FakeAuth();
    const reads = new FakeReads().user('uid-1', 'user');
    const { requireAdmin } = createGuards({ auth, reads });

    const error = await requireAdmin(await requestFrom(auth, 'uid-1')).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error).toMatchObject({ status: 403, uid: 'uid-1' });
    // 401 here would send a perfectly good session into a re-login loop.
    expect(error).not.toBeInstanceOf(InvalidSessionError);
  });

  it('answers 401 rather than 403 when there is no session at all', async () => {
    const auth = new FakeAuth();
    const { requireAdmin } = createGuards({ auth, reads: new FakeReads() });

    await expect(requireAdmin(fakeEvent())).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('requireOrgRole', () => {
  it('passes a member holding one of the named roles', async () => {
    const auth = new FakeAuth();
    const reads = new FakeReads()
      .user('uid-1', 'user')
      .org('org-a', { 'uid-1': member('manager') });
    const { requireOrgRole } = createGuards({ auth, reads });

    const context = await requireOrgRole(
      await requestFrom(auth, 'uid-1'),
      'org-a',
      'admin',
      'manager',
    );

    expect(context.orgRole).toBe('manager');
    expect(context.viaPlatformAdmin).toBe(false);
    expect(context.orgId).toBe('org-a');
  });

  it('hands back the organizer document so the route need not read it', async () => {
    const auth = new FakeAuth();
    const reads = new FakeReads()
      .user('uid-1', 'user')
      .org('org-a', { 'uid-1': member('admin') });
    const { requireOrgRole } = createGuards({ auth, reads });

    const context = await requireOrgRole(
      await requestFrom(auth, 'uid-1'),
      'org-a',
      'admin',
    );

    expect(context.org).toEqual(reads.orgs.get('org-a'));
  });

  // The two role refusals the ticket names.
  it('refuses a check_in member an event edit', async () => {
    const auth = new FakeAuth();
    const reads = new FakeReads()
      .user('uid-1', 'user')
      .org('org-a', { 'uid-1': member('check_in') });
    const { requireOrgRole } = createGuards({ auth, reads });

    await expect(
      requireOrgRole(
        await requestFrom(auth, 'uid-1'),
        'org-a',
        'admin',
        'manager',
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a volunteer a check-in', async () => {
    const auth = new FakeAuth();
    const reads = new FakeReads()
      .user('uid-1', 'user')
      .org('org-a', { 'uid-1': member('volunteer') });
    const { requireOrgRole } = createGuards({ auth, reads });

    await expect(
      requireOrgRole(
        await requestFrom(auth, 'uid-1'),
        'org-a',
        'admin',
        'manager',
        'check_in',
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a member of one org on another org', async () => {
    const auth = new FakeAuth();
    const reads = new FakeReads()
      .user('uid-1', 'user')
      .org('org-a', { 'uid-1': member('admin') })
      .org('org-b', { 'uid-2': member('admin') });
    const { requireOrgRole } = createGuards({ auth, reads });

    await expect(
      requireOrgRole(await requestFrom(auth, 'uid-1'), 'org-b', 'admin'),
    ).rejects.toMatchObject({ status: 403 });
  });

  // The membership-oracle test: an outsider must not be able to tell an org
  // that exists from one that does not by probing.
  it('answers a missing org exactly as it answers an org that is not yours', async () => {
    const auth = new FakeAuth();
    const reads = new FakeReads()
      .user('uid-1', 'user')
      .org('org-b', { 'uid-2': member('admin') });
    const { requireOrgRole } = createGuards({ auth, reads });
    const event = await requestFrom(auth, 'uid-1');

    // org-b exists and belongs to someone else; org-c does not exist at all.
    const onExisting = await refusal(requireOrgRole(event, 'org-b', 'admin'));
    const onMissing = await refusal(requireOrgRole(event, 'org-c', 'admin'));

    expect(onMissing.status).toBe(onExisting.status);
    expect(onMissing.constructor).toBe(onExisting.constructor);
    // Even the message must not differ — it is the other thing that gets
    // echoed into a response by accident.
    expect(onMissing.message).toBe(
      onExisting.message.replace('org-b', 'org-c'),
    );
  });

  it('never answers 404 for an org the caller may not see', async () => {
    const auth = new FakeAuth();
    const reads = new FakeReads().user('uid-1', 'user');
    const { requireOrgRole } = createGuards({ auth, reads });

    const error = await requireOrgRole(
      await requestFrom(auth, 'uid-1'),
      'org-that-does-not-exist',
      'admin',
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error).toMatchObject({ status: 403 });
  });

  it('lets a platform admin into an org they are not a member of', async () => {
    const auth = new FakeAuth();
    const reads = new FakeReads()
      .user('uid-1', 'admin')
      .org('org-a', { 'uid-2': member('admin') });
    const { requireOrgRole } = createGuards({ auth, reads });

    const context = await requireOrgRole(
      await requestFrom(auth, 'uid-1'),
      'org-a',
      'admin',
    );

    expect(context.orgRole).toBe('admin');
    expect(context.viaPlatformAdmin).toBe(true);
  });

  it('reports a platform admin as such even when they are also a member', async () => {
    const auth = new FakeAuth();
    const reads = new FakeReads()
      .user('uid-1', 'admin')
      .org('org-a', { 'uid-1': member('check_in') });
    const { requireOrgRole } = createGuards({ auth, reads });

    const context = await requireOrgRole(
      await requestFrom(auth, 'uid-1'),
      'org-a',
      'admin',
    );

    // Platform authority wins over the membership entry, and the route can see
    // that it did.
    expect(context.orgRole).toBe('admin');
    expect(context.viaPlatformAdmin).toBe(true);
  });

  it('refuses even a platform admin on an org that does not exist', async () => {
    const auth = new FakeAuth();
    const reads = new FakeReads().user('uid-1', 'admin');
    const { requireOrgRole } = createGuards({ auth, reads });

    await expect(
      requireOrgRole(await requestFrom(auth, 'uid-1'), 'nope', 'admin'),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('authorizes before it looks anything up', async () => {
    const auth = new FakeAuth();
    const reads = new FakeReads();
    const { requireOrgRole } = createGuards({ auth, reads });

    // No session: the org is never read, so nothing about it can be leaked and
    // no read is billed for an anonymous prober.
    await expect(
      requireOrgRole(fakeEvent(), 'org-a', 'admin'),
    ).rejects.toMatchObject({ status: 401 });
    expect(reads.calls).toEqual([]);
  });

  it('treats naming no roles as a programming error, not a pass', async () => {
    const auth = new FakeAuth();
    const reads = new FakeReads()
      .user('uid-1', 'user')
      .org('org-a', { 'uid-1': member('volunteer') });
    const { requireOrgRole } = createGuards({ auth, reads });
    const event = await requestFrom(auth, 'uid-1');

    const error = await requireOrgRole(event, 'org-a').catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ForbiddenError);
    expect((error as Error).message).toContain('no roles');
    // It failed before authenticating, so it cannot be mistaken for a verdict.
    expect(reads.calls).toEqual([]);
  });
});
