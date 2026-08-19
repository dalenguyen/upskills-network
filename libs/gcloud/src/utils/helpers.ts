export const objectToArray = (envVars: Record<string, string>): string[] =>
  Object.entries(envVars).map(([key, value]) => `${key}=${value}`);

/**
 * Quote a value so `/bin/sh` — which `execCommand` runs every command through —
 * passes it as one literal argument. Single quotes protect every shell
 * metacharacter (` `, `<`, `>`, `$`, `&`, `;`, …). An embedded single quote is
 * escaped with the standard `'\''` idiom: close the quote, escape a quote, and
 * reopen.
 *
 * This is what lets an env var like `EMAIL_FROM=Upskills Network <dale@…>` reach
 * `gcloud run deploy` intact instead of being torn apart into a redirect.
 */
export const shellQuote = (value: string): string =>
  `'${value.replace(/'/g, "'\\''")}'`;
