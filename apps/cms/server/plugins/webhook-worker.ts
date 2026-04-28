import { prisma } from '../utils/prisma';
import { startWorker, stopWorker } from '../utils/webhookWorker';

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

  startWorker({
    prisma: prisma as never,
    fetch: (url, init) => fetch(url, init as RequestInit),
  });

  nitroApp.hooks.hookOnce('close', () => {
    stopWorker();
  });
});
