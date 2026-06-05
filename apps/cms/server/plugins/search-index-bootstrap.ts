import { meili } from '../utils/meili';
import { ensureEntriesIndex } from '../utils/searchIndex';

// `meili` and `ensureEntriesIndex` are imported explicitly: Nuxt server
// auto-imports do not reliably resolve inside `defineNitroPlugin` callbacks in
// the production bundle (same reason webhook-worker.ts imports prisma directly).
export default defineNitroPlugin(async () => {
  // Skip in test mode. Integration tests boot a dev Nitro server and
  // Meilisearch is not guaranteed up until #223 wires it into CI; the bootstrap
  // logic is unit-tested directly via ensureEntriesIndex. Dev (`pnpm dev`) and
  // production still bootstrap the index on boot.
  if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
    return;
  }

  try {
    await ensureEntriesIndex(meili);
  } catch (error) {
    // Non-fatal: a boot with Meilisearch unreachable must NOT crash the CMS
    // (graceful degradation — search is non-essential to the admin shell).
    // /api/health reports "unavailable"; the index bootstraps on a later boot
    // once Meilisearch is reachable.
    console.warn(
      '[search] entries index bootstrap failed; search will be unavailable until Meilisearch is reachable:',
      error
    );
  }
});
