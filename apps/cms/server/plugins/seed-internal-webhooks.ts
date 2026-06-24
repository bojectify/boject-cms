import { prisma } from '../utils/prisma';
import { ensureSearchSyncWebhook } from '../utils/ensureSearchSyncWebhook';
import { ensureCacheInvalidationWebhook } from '../utils/ensureCacheInvalidationWebhook';

// `prisma` and `ensureSearchSyncWebhook` are imported explicitly: Nuxt server
// auto-imports do not reliably resolve inside `defineNitroPlugin` callbacks in
// the production bundle (same reason webhook-worker.ts / search-index-bootstrap
// import their deps directly).
export default defineNitroPlugin(async () => {
  // Skip in test mode: integration tests boot a dev Nitro server and an
  // unconditional seed would inject the internal row into boject_test and
  // pollute the webhook list/CRUD tests. The seed logic is integration-tested
  // directly via ensureSearchSyncWebhook. Dev + production seed on boot.
  if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
    return;
  }
  try {
    await ensureSearchSyncWebhook(prisma);
    await ensureCacheInvalidationWebhook(prisma);
  } catch (error) {
    // Non-fatal: a boot with the DB briefly unreachable must not crash the CMS.
    console.warn(
      '[internal-webhooks] failed to seed internal webhooks:',
      error
    );
  }
});
