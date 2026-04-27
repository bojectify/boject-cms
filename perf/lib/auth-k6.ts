import http from 'k6/http';
import { check } from 'k6';
import { loadK6Config } from './config-k6';

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

// Session auth: POST /api/auth/login, extract `Set-Cookie` and reuse it.
// Called from scenario setup() — runs once per VU cluster.
export function sessionLoginCookie(): string {
  const cfg = loadK6Config();
  const res = http.post(
    `${cfg.baseUrl}/api/auth/login`,
    JSON.stringify({ email: cfg.adminEmail, password: cfg.adminPassword }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(res, { 'login 200': (r) => r.status === 200 });
  const setCookie = res.headers['Set-Cookie'] ?? '';
  const cookie = setCookie.split(';')[0] ?? '';
  if (!cookie.startsWith('nuxt-session=')) {
    throw new Error(`login did not return session cookie: ${setCookie}`);
  }
  return cookie;
}

export function sessionHeaders(cookie: string): Record<string, string> {
  return {
    Cookie: cookie,
    'Content-Type': 'application/json',
    Origin: loadK6Config().baseUrl,
  };
}
