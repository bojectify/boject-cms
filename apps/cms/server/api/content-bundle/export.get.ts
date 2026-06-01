import { defineEventHandler, getQuery } from 'h3';
import { exportBundle } from '../../../scripts/content-bundle/export';
import { assertApiKeyScope } from '../../utils/assertApiKeyScope';

/**
 * Export dynamic-content ENTRIES as a portable JSON bundle for remote
 * `boject entries import`. References-only: IMAGE `storageKey`s are carried
 * verbatim — the operator clones the storage bucket out-of-band.
 *
 * Gated by `content:export` (bulk extraction is its own privilege, distinct
 * from GraphQL `content:read`). Defaults to published-only; drafts require
 * `?includeDrafts=true` — no extra scope, since holding `content:export`
 * already authorises full extraction.
 *
 * Query:
 *   portable       default 'true'; 'false' preserves real UUIDs
 *   includeDrafts  'true' includes DRAFT/CHANGED versions (default: published-only)
 *   contentType    restrict to one ContentType identifier
 */
export default defineEventHandler(async (event) => {
  assertApiKeyScope(event, 'content:export');
  const query = getQuery(event);
  const bundle = await exportBundle(prisma, {
    mode: 'entries',
    portable: query.portable !== 'false',
    // Published-only is the default; includeDrafts flips it off.
    publishedOnly: query.includeDrafts !== 'true',
    contentType:
      typeof query.contentType === 'string' ? query.contentType : undefined,
  });
  return bundle;
});
