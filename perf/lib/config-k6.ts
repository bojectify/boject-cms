// k6 runtime (goja VM). Reads `__ENV` — no process.env, no node_modules.

export interface PerfK6Config {
  baseUrl: string;
  apiKey: string | undefined;
  adminEmail: string;
  adminPassword: string;
}

export function loadK6Config(): PerfK6Config {
  const baseUrl = (__ENV.PERF_BASE_URL || 'http://localhost:4000').replace(
    /\/$/,
    ''
  );
  return {
    baseUrl,
    apiKey: __ENV.PERF_API_KEY || undefined,
    adminEmail: __ENV.PERF_ADMIN_EMAIL || 'admin@example.com',
    adminPassword: __ENV.PERF_ADMIN_PASSWORD || 'password',
  };
}
