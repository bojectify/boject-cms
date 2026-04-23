import { startWorker, stopWorker } from '../utils/webhookWorker';

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
