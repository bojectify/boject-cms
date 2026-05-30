import { createHash } from 'node:crypto';

// KEEP IN SYNC with PERF_KEY_RAW in apps/cms/prisma/seed.ts —
// a drift here silently 401s every k6 scenario.
const PERF_KEY_RAW = 'boject_perf_key_for_load_tests_only';

export interface EnsureOpts {
  prisma: {
    apiKey: {
      findUnique: (args: { where: { keyHash: string } }) => Promise<unknown>;
    };
  };
}

export async function ensurePerfApiKey(opts: EnsureOpts): Promise<string> {
  const keyHash = createHash('sha256').update(PERF_KEY_RAW).digest('hex');
  const row = await opts.prisma.apiKey.findUnique({ where: { keyHash } });
  if (!row) {
    throw new Error('Perf API key not found. Run: pnpm prisma:seed:perf');
  }
  return PERF_KEY_RAW;
}

export const PERF_API_KEY_PLAINTEXT = PERF_KEY_RAW;
