import { z } from 'zod';
import { EmailSchema, IdSchema, OrgRoleSchema, SlugSchema } from './primitives';

/**
 * New organizer. `slug` must be free — uniqueness is enforced by the
 * `orgSlugs/{slug}` reservation doc, not by this schema.
 */
export const CreateOrgSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: SlugSchema,
});

/**
 * Add or change one member of an organizer. Writes both `members[uid]` and
 * `memberUids` — the map is what security rules read, the array is what
 * `array-contains` queries read.
 */
export const OrgMemberSchema = z.object({
  uid: IdSchema,
  role: OrgRoleSchema,
});

/**
 * The same operation, named by the member's email instead of their uid.
 *
 * A uid is a value nobody can type from memory, so the member-management UI
 * asks for an email and the route resolves it to the uid the org document is
 * keyed by. The membership itself is still keyed by uid — an email is how a
 * human names a person, not how the roster stores one.
 */
export const OrgMemberByEmailSchema = z.object({
  email: EmailSchema,
  role: OrgRoleSchema,
});

/**
 * Add or change one member, named either way. The uid form stays because the
 * roster the browser already holds is keyed by uid: a role change on a row does
 * not need a second identity lookup, and an account whose email later changes
 * is still reachable.
 */
export const SetOrgMemberSchema = z.union([
  OrgMemberSchema,
  OrgMemberByEmailSchema,
]);

export type CreateOrgInput = z.infer<typeof CreateOrgSchema>;
export type OrgMemberInput = z.infer<typeof OrgMemberSchema>;
export type OrgMemberByEmailInput = z.infer<typeof OrgMemberByEmailSchema>;
export type SetOrgMemberInput = z.infer<typeof SetOrgMemberSchema>;
