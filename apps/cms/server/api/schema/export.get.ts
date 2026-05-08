import { defineEventHandler, getQuery } from 'h3';
import { exportBundle } from '../../../scripts/content-bundle/export';
import { assertApiKeyScope } from '../../utils/assertApiKeyScope';

export default defineEventHandler(async (event) => {
  assertApiKeyScope(event, 'schema:read');
  // `portable=true` (default) strips UUIDs to null and replaces RELATION
  // refs with identifier-based pointers — suitable for cross-instance
  // `boject schema apply`. `portable=false` preserves real UUIDs — needed
  // by `boject perf seed --http-seed` so the CLI can POST entries with
  // valid contentTypeId UUIDs.
  const query = getQuery(event);
  const portable = query.portable !== 'false';
  const bundle = await exportBundle(prisma, {
    mode: 'schema',
    portable,
  });
  return bundle;
});
