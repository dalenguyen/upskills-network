import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessage } from '../send';
import { renderOrgInviteEmail, type OrgInviteEmailDetails } from './invite';

/**
 * The staff invitation, rendered. No client, no key, no network.
 *
 * The property that matters most here is the link: it carries the only
 * credential that accepts the invitation, so it must be present, correct, and
 * built from the token rather than from anything guessable.
 */

const DETAILS: OrgInviteEmailDetails = {
  email: 'grace@example.com',
  orgName: 'Upskills Toronto',
  role: 'manager',
  token: 'tok-secret',
  expiresAt: new Date('2026-09-08T18:00:00.000Z'),
  invitedByName: 'Ada',
};

/** The HTML and text parts, so one assertion covers both. */
function bodies(message: EmailMessage): string[] {
  return [message.html, message.text];
}

beforeEach(() => {
  vi.stubEnv('SITE_URL', 'https://upskills.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('org invitation email', () => {
  it('is addressed to the invitee and names the org in the subject', () => {
    const message = renderOrgInviteEmail(DETAILS);

    expect(message.to).toBe('grace@example.com');
    expect(message.subject).toBe(
      "You've been invited to join Upskills Toronto on Upskills",
    );
  });

  it('carries the acceptance link built from the token', () => {
    for (const body of bodies(renderOrgInviteEmail(DETAILS))) {
      expect(body).toContain('https://upskills.test/invites/tok-secret');
    }
  });

  it('names the org, the role, and who sent it', () => {
    for (const body of bodies(renderOrgInviteEmail(DETAILS))) {
      expect(body).toContain('Upskills Toronto');
      expect(body).toContain('Manager');
      expect(body).toContain('Ada');
    }
  });

  it('falls back to the org name when the inviter has none', () => {
    const message = renderOrgInviteEmail({
      ...DETAILS,
      invitedByName: undefined,
    });

    expect(message.text).toContain('Upskills Toronto invited you');
  });

  it('says the invitation grants nothing until it is accepted', () => {
    for (const body of bodies(renderOrgInviteEmail(DETAILS))) {
      expect(body).toContain('not added to the organizer until you do');
      // Apostrophes are entity-escaped in the HTML part, so match around one.
      expect(body).toContain('expecting this invitation');
    }
  });

  it('prints the expiry as a date', () => {
    for (const body of bodies(renderOrgInviteEmail(DETAILS))) {
      expect(body).toContain('September 8, 2026');
    }
  });

  it('escapes an org name that contains markup', () => {
    const message = renderOrgInviteEmail({
      ...DETAILS,
      orgName: '<script>alert(1)</script>',
    });

    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
  });
});
