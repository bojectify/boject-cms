export interface PerfNodeConfig {
  baseUrl: string;
  perfDatabaseUrl: string;
  apiKey: string | undefined;
  adminEmail: string;
  adminPassword: string;
}

const DEFAULTS = {
  baseUrl: 'http://localhost:4000',
  perfDatabaseUrl: 'postgresql://boject:boject@localhost:5432/boject_perf',
  adminEmail: 'admin@example.com',
  adminPassword: 'password',
};

export function loadNodeConfig(
  env: NodeJS.ProcessEnv = process.env
): PerfNodeConfig {
  const baseUrl = (env.PERF_BASE_URL ?? DEFAULTS.baseUrl).replace(/\/$/, '');
  return {
    baseUrl,
    perfDatabaseUrl: env.PERF_DATABASE_URL ?? DEFAULTS.perfDatabaseUrl,
    apiKey: env.PERF_API_KEY,
    adminEmail: env.PERF_ADMIN_EMAIL ?? DEFAULTS.adminEmail,
    adminPassword: env.PERF_ADMIN_PASSWORD ?? DEFAULTS.adminPassword,
  };
}
