import { z } from 'zod';
import { IdSchema, OrgRoleSchema, SlugSchema } from './primitives';

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

export type CreateOrgInput = z.infer<typeof CreateOrgSchema>;
export type OrgMemberInput = z.infer<typeof OrgMemberSchema>;
