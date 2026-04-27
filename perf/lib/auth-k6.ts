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

// Session auth: POST /api/auth/login, pull the session cookie from the
// parsed cookie jar (k6 splits Set-Cookie for us). Called from scenario
// setup() — runs once per VU cluster.
export function sessionLoginCookie(): string {
  const cfg = loadK6Config();
  const res = http.post(
    `${cfg.baseUrl}/api/auth/login`,
    JSON.stringify({ email: cfg.adminEmail, password: cfg.adminPassword }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(res, { 'login 200': (r) => r.status === 200 });
  const sessionCookies = res.cookies['nuxt-session'];
  if (!sessionCookies?.length) {
    throw new Error(
      `login did not return nuxt-session cookie. Set-Cookie: ${
        res.headers['Set-Cookie'] ?? '(none)'
      }`
    );
  }
  return `nuxt-session=${sessionCookies[0]!.value}`;
}

// Origin must match the request Host so the cms's CSRF middleware
// (apps/cms/server/middleware/csrf.ts) accepts session-cookie mutations.
export function sessionHeaders(cookie: string): Record<string, string> {
  return {
    Cookie: cookie,
    'Content-Type': 'application/json',
    Origin: loadK6Config().baseUrl,
  };
}
