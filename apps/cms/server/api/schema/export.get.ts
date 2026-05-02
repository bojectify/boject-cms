import { defineEventHandler } from 'h3';
import { exportBundle } from '../../../scripts/content-bundle/export';
import { assertApiKeyScope } from '../../utils/assertApiKeyScope';

export default defineEventHandler(async (event) => {
  assertApiKeyScope(event, 'schema:read');
  const bundle = await exportBundle(prisma, {
    mode: 'schema',
    portable: true,
  });
  return bundle;
});
