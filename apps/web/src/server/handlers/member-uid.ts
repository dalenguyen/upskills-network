import type { User } from '@upskills/models';
import type { SetOrgMemberInput } from '@upskills/validation';
import { notFound } from './http-error';

/**
 * Turn "who the caller named" into the uid a membership is keyed by.
 *
 * The member-management UI asks for an email, because a uid is not something a
 * human can type. The org document is still keyed by uid — `members[uid]` is
 * what the security rules read and `memberUids` is what `array-contains`
 * queries read — so exactly one place has to bridge the two, and this is it.
 * The admin console and the organizer dashboard share it so the two surfaces
 * cannot disagree about what an unknown email means.
 *
 * An email with no `users/{uid}` document is a 404: this is a *member* write,
 * not an invitation, and a user document only exists once that person has
 * signed in at least once. Answering 404 says so, instead of storing a
 * membership under an id that will never authenticate.
 */

export interface MemberUidDeps {
  /** `findUserByEmail` from `@upskills/firestore`. */
  findUserByEmail(email: string): Promise<User | null>;
}

/** The uid the body names, whether it named a uid or an email. */
export async function resolveMemberUid(
  deps: MemberUidDeps,
  member: SetOrgMemberInput,
): Promise<string> {
  if ('uid' in member) {
    return member.uid;
  }

  const user = await deps.findUserByEmail(member.email);

  if (user === null) {
    throw notFound(
      'user-not-found',
      'No account with that email address. They need to sign in once before they can be added.',
    );
  }

  return user.uid;
}
