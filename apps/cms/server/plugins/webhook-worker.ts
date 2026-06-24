import { prisma } from '../utils/prisma';
import { startWorker, stopWorker } from '../utils/webhookWorker';
import { meili } from '../utils/meili';
import { resolveEntriesIndex } from '../utils/searchIndex';
import { syncToSearchIndex } from '../utils/syncToSearchIndex';
import type { SearchDocument } from '../utils/searchDocument';
import { SEARCH_SYNC_WEBHOOK_NAME } from '../utils/ensureSearchSyncWebhook';

// `prisma` is imported explicitly here because Nuxt server auto-imports do
// not consistently resolve inside `defineNitroPlugin` callbacks in the
// production bundle — the bundler emits a bare `prisma` reference and the
// server crashes on boot with `ReferenceError: prisma is not defined`. API
// routes and middleware are fine; plugins need the explicit import.
export default defineNitroPlugin((nitroApp) => {
  // Skip the interval-driven worker in test mode. Integration tests boot a
  // dev Nitro server and would otherwise see the worker race their
  // enqueue → assert cycle (fixture webhooks point at https://example.com/hook
  // which returns 200, flipping deliveries to SUCCESS mid-assertion).
  // Task 21's E2E test drives `runWorkerTick` directly against a stub server.
  if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
    return;
  }

  const allowPrivate =
    process.env.NODE_ENV !== 'production' ||
    process.env.WEBHOOK_ALLOW_PRIVATE_URLS === 'true';

  startWorker({
    prisma: prisma as never,
    // The `dispatcher` field is preserved by the cast — Node's global `fetch`
    // is undici under the hood and honours it, even though the standard DOM
    // `RequestInit` type doesn't list it. Don't simplify this to a destructure
    // that drops the field.
    fetch: (url, init) =>
      fetch(url, init as RequestInit & { dispatcher?: unknown }),
    allowPrivate,
    internalHandlers: {
      [SEARCH_SYNC_WEBHOOK_NAME]: (payload) =>
        syncToSearchIndex(
          { prisma, index: meili.index<SearchDocument>(resolveEntriesIndex()) },
          payload
        ),
    },
  });

  nitroApp.hooks.hookOnce('close', () => {
    stopWorker();
  });
});
