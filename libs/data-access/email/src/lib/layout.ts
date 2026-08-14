import type { EmailMessage } from './send';

/**
 * One shell for every email this library sends, rendered twice — as HTML and as
 * plain text — from a single description of the content.
 *
 * ## Why templates describe content instead of writing HTML
 *
 * Email HTML is not web HTML. Outlook renders through Word, which has no
 * flexbox, no grid, and no reliable `padding` on a `div`; Gmail strips `<style>`
 * blocks and anything it fetches; Apple Mail is the only one that behaves. The
 * markup that survives all three is a nest of `<table>`s with inline styles on
 * every cell, and it is not something anyone should be hand-writing ten times
 * and keeping consistent.
 *
 * So a template returns an {@link EmailLayout} — a heading, some paragraphs, a
 * few labelled facts, at most one button — and this module owns the markup. Nine
 * templates then share one set of email-client workarounds, and fixing a
 * rendering bug fixes it everywhere.
 *
 * ## Why the plain-text part is generated, not written
 *
 * A message with no `text/plain` part scores worse with spam filters and is
 * unreadable in text-only clients, but a hand-written text version is a second
 * copy that drifts — and the copy that drifts is always the one nobody reads
 * during review. Both parts come off the same {@link EmailLayout} here, so a
 * change to the wording cannot land in one and not the other. In particular
 * {@link renderText} prints every link as a bare URL, so the cancel link is
 * present and clickable even when the HTML never renders.
 *
 * ## Escaping
 *
 * Guest names and event titles are free text somebody typed into a public form.
 * Every value interpolated into the HTML goes through {@link escapeHtml}; the
 * only markup in the output is the markup in this file.
 */

/** What a template wants said, independent of how it is rendered. */
export interface EmailLayout {
  /**
   * The grey line an inbox shows after the subject.
   *
   * Worth setting deliberately: left out, clients grab the first text in the
   * body, which is usually the heading repeated back — a wasted line of the
   * very small amount of space an email gets to earn its open.
   */
  readonly preheader: string;
  readonly heading: string;
  /** Body paragraphs, in order. Plain text; escaped on render. */
  readonly paragraphs: readonly string[];
  /** Labelled details — when, where, how much. Rendered as a two-column table. */
  readonly facts?: readonly EmailFact[];
  /** At most one primary action. More than one button and neither gets pressed. */
  readonly action?: { readonly label: string; readonly url: string };
  /**
   * Smaller print under the action: the cancel link, the refund policy.
   * `url` turns the note into a link; without one it is a sentence.
   */
  readonly notes?: readonly EmailNote[];
}

export interface EmailFact {
  readonly label: string;
  readonly value: string;
}

export interface EmailNote {
  readonly text: string;
  readonly url?: string;
}

/** Body width, in pixels. 600 is the width every email client agrees on. */
const WIDTH = 600;

const INK = '#111827';
const MUTED = '#6b7280';
const ACCENT = '#1d4ed8';
const BORDER = '#e5e7eb';
const PAGE = '#f3f4f6';

/**
 * The font stack. No web fonts: Outlook ignores `@font-face`, and a font a
 * client has to fetch is a network request in a medium that may have none.
 */
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * A complete message from a layout.
 *
 * The single place that pairs a subject with both rendered bodies, so a template
 * cannot produce HTML without the matching text.
 */
export function composeMessage(
  to: string,
  subject: string,
  layout: EmailLayout,
): EmailMessage {
  return {
    to,
    subject,
    html: renderHtml(layout),
    text: renderText(layout),
  };
}

/** The layout as email-client-safe HTML. */
export function renderHtml(layout: EmailLayout): string {
  const parts: string[] = [];

  parts.push(
    `<h1 style="margin:0 0 16px;font-size:22px;line-height:30px;font-weight:600;color:${INK};">${escapeHtml(
      layout.heading,
    )}</h1>`,
  );

  for (const paragraph of layout.paragraphs) {
    parts.push(
      `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:${INK};">${escapeHtml(
        paragraph,
      )}</p>`,
    );
  }

  if (layout.facts?.length) {
    parts.push(renderFacts(layout.facts));
  }

  if (layout.action) {
    parts.push(renderButton(layout.action.label, layout.action.url));
  }

  if (layout.notes?.length) {
    parts.push(renderNotes(layout.notes));
  }

  // The preheader is hidden text: `display:none` alone is not enough, because
  // some clients still lay it out, so it is also collapsed to zero size and
  // pushed out of the visible palette.
  const preheader =
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;` +
    `font-size:1px;line-height:1px;color:${PAGE};opacity:0;">${escapeHtml(
      layout.preheader,
    )}</div>`;

  // `role="presentation"` keeps screen readers from announcing the layout
  // tables as data tables. `border-collapse` and the explicit width are what
  // stop Outlook adding gaps of its own between cells.
  return `${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAGE};margin:0;padding:24px 0;">
  <tr>
    <td align="center" style="padding:0 12px;">
      <table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${WIDTH}px;background-color:#ffffff;border:1px solid ${BORDER};border-radius:8px;">
        <tr>
          <td style="padding:32px;font-family:${FONT};">
${parts.join('\n')}
          </td>
        </tr>
      </table>
      <table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${WIDTH}px;">
        <tr>
          <td style="padding:16px 32px;font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};">
            You are receiving this because you registered for an event on Upskills Network.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

/**
 * The layout as plain text.
 *
 * Links are printed in full rather than as anchor text. A text-only reader
 * cannot follow "cancel your registration" if the URL is not on the page, and
 * the cancel link is the one thing in these emails a guest may genuinely need.
 */
export function renderText(layout: EmailLayout): string {
  const blocks: string[] = [layout.heading, ...layout.paragraphs];

  if (layout.facts?.length) {
    blocks.push(
      layout.facts.map((fact) => `${fact.label}: ${fact.value}`).join('\n'),
    );
  }

  if (layout.action) {
    blocks.push(`${layout.action.label}: ${layout.action.url}`);
  }

  for (const note of layout.notes ?? []) {
    blocks.push(note.url ? `${note.text}\n${note.url}` : note.text);
  }

  return `${blocks.join('\n\n')}\n`;
}

/**
 * HTML-escape a value for interpolation into text or an attribute.
 *
 * Both quote forms are escaped so one function is safe in both positions —
 * a second, subtly different escaper is how an injection eventually gets in.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderFacts(facts: readonly EmailFact[]): string {
  const rows = facts
    .map(
      (fact) => `        <tr>
          <td style="padding:8px 16px 8px 0;font-size:13px;line-height:20px;color:${MUTED};white-space:nowrap;vertical-align:top;">${escapeHtml(
            fact.label,
          )}</td>
          <td style="padding:8px 0;font-size:15px;line-height:22px;color:${INK};vertical-align:top;">${escapeHtml(
            fact.value,
          )}</td>
        </tr>`,
    )
    .join('\n');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;border-top:1px solid ${BORDER};border-bottom:1px solid ${BORDER};">
${rows}
</table>`;
}

/**
 * A button that survives Outlook.
 *
 * A styled `<a>` is not enough — Word's renderer drops padding on inline
 * elements, leaving a bare link. Wrapping it in a single-cell table with the
 * background on the `<td>` and the padding on the anchor gives every client
 * something it understands.
 */
function renderButton(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
  <tr>
    <td align="center" bgcolor="${ACCENT}" style="background-color:${ACCENT};border-radius:6px;">
      <a href="${escapeHtml(
        url,
      )}" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(
        label,
      )}</a>
    </td>
  </tr>
</table>`;
}

function renderNotes(notes: readonly EmailNote[]): string {
  return notes
    .map((note) => {
      const body = note.url
        ? `${escapeHtml(note.text)} <a href="${escapeHtml(
            note.url,
          )}" style="color:${ACCENT};">${escapeHtml(note.url)}</a>`
        : escapeHtml(note.text);

      return `<p style="margin:0 0 12px;font-size:13px;line-height:20px;color:${MUTED};word-break:break-all;">${body}</p>`;
    })
    .join('\n');
}
