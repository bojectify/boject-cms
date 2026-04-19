#!/usr/bin/env tsx
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const HEALTH_URL = 'http://localhost:4000/api/health';
const LOGIN_URL = 'http://localhost:4000/api/auth/login';
const CONTENT_TYPES_URL = 'http://localhost:4000/api/content-types';
const BOOT_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;

interface EnvVars {
  adminEmail: string;
  adminPassword: string;
  hasStarter: boolean;
}

function parseEnv(contents: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    map.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  return map;
}

async function readEnv(dir: string): Promise<EnvVars> {
  const contents = await readFile(resolve(dir, '.env'), 'utf8');
  const env = parseEnv(contents);
  const adminEmail = env.get('BOJECT_ADMIN_EMAIL');
  const adminPassword = env.get('BOJECT_ADMIN_PASSWORD');
  if (!adminEmail) throw new Error('.env missing BOJECT_ADMIN_EMAIL');
  if (!adminPassword) throw new Error('.env missing BOJECT_ADMIN_PASSWORD');
  return {
    adminEmail,
    adminPassword,
    hasStarter: env.has('BOJECT_INITIAL_STARTER'),
  };
}

function composeUp(dir: string): void {
  // Always pull so we test the latest published image, not a stale cached digest.
  const pull = spawnSync('docker', ['compose', 'pull'], {
    cwd: dir,
    stdio: 'inherit',
  });
  if (pull.status !== 0) throw new Error('docker compose pull failed');

  const up = spawnSync('docker', ['compose', 'up', '-d'], {
    cwd: dir,
    stdio: 'inherit',
  });
  if (up.status !== 0) throw new Error('docker compose up failed');
}

function composeDown(dir: string): void {
  spawnSync('docker', ['compose', 'down', '-v'], {
    cwd: dir,
    stdio: 'inherit',
  });
}

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTH_URL);
      if (res.ok) return;
    } catch {
      // connection refused while container still booting
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Health check timed out after ${BOOT_TIMEOUT_MS}ms`);
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed: HTTP ${res.status}`);
  const setCookies = res.headers.getSetCookie();
  if (setCookies.length === 0)
    throw new Error('Login response missing Set-Cookie');
  return setCookies.map((c) => c.split(';')[0]).join('; ');
}

async function assertContentTypes(cookie: string): Promise<void> {
  const res = await fetch(CONTENT_TYPES_URL, { headers: { Cookie: cookie } });
  if (!res.ok)
    throw new Error(`GET /api/content-types failed: HTTP ${res.status}`);
  const body = (await res.json()) as { items?: unknown[] };
  const count = Array.isArray(body.items) ? body.items.length : 0;
  if (count === 0) {
    throw new Error('Expected at least one content type but got zero');
  }
}

async function main(): Promise<void> {
  const targetDir = process.argv[2];
  if (!targetDir) {
    process.stderr.write('Usage: pnpm dev:verify <dir>\n');
    process.exit(1);
  }
  const dir = resolve(targetDir);
  if (!existsSync(resolve(dir, 'docker-compose.yml'))) {
    process.stderr.write(`No docker-compose.yml found in ${dir}\n`);
    process.exit(1);
  }

  const env = await readEnv(dir);
  let failureMessage: string | null = null;

  try {
    composeUp(dir);
    await waitForHealth();
    const cookie = await login(env.adminEmail, env.adminPassword);
    if (env.hasStarter) {
      await assertContentTypes(cookie);
    }
    process.stdout.write('dev:verify: OK\n');
  } catch (error) {
    failureMessage = error instanceof Error ? error.message : String(error);
    process.stderr.write(`dev:verify failed: ${failureMessage}\n`);
    process.stderr.write(
      `To inspect the running container manually, rerun \`docker compose up -d\` in ${dir} and check \`docker compose logs cms\`.\n`
    );
  } finally {
    composeDown(dir);
  }

  process.exit(failureMessage === null ? 0 : 1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Unhandled error: ${message}\n`);
  process.exit(1);
});
