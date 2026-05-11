import { loadK6Config } from './config-k6.ts';

export function apiKeyHeaders(): Record<string, string> {
  const cfg = loadK6Config();
  if (!cfg.apiKey) {
    throw new Error(
      'PERF_API_KEY not set. Run: SEED_PERF_KEY=1 pnpm prisma:seed and export PERF_API_KEY=boject_perf_key_for_load_tests_only'
    );
  }
  return {
    Authorization: `Bearer ${cfg.apiKey}`,
    'Content-Type': 'application/json',
  };
}
