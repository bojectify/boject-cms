/**
 * Canonical slug algorithm. Used by the entry editor (client), the
 * content-entry create endpoint (server), and `tsx`-run scripts.
 *
 * The Postgres regex in the entryKey migration mirrors this exactly:
 *   regexp_replace(
 *     regexp_replace(lower(s), '[^a-z0-9]+', '-', 'g'),
 *     '^-|-$', '', 'g'
 *   )
 *
 * The vendored copy in `packages/boject-cli/src/vendor/slugify.ts` MUST
 * remain byte-identical. See `packages/boject-cli/tests/unit/vendorDrift.test.ts`.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
