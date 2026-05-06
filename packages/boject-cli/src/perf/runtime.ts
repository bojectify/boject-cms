import { spawn } from 'node:child_process';

const K6_VERSION_TIMEOUT_MS = 5000;
const HEALTH_TIMEOUT_MS = 10000;

/**
 * Probe whether `k6` is on PATH. Spawns `k6 version` with a 5-second
 * timeout — protects against hanging shadow installs on misconfigured
 * PATHs.
 */
export async function defaultK6Available(): Promise<boolean> {
  return new Promise((resolveResult) => {
    const child = spawn('k6', ['version'], { stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill();
      resolveResult(false);
    }, K6_VERSION_TIMEOUT_MS);
    child.on('error', () => {
      clearTimeout(timer);
      resolveResult(false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveResult(code === 0);
    });
  });
}

/**
 * Probe `<url>/api/health` with a 10-second timeout. Returns the
 * preflight error shape so it composes with `runPreflight`.
 */
export async function defaultFetchHealth(
  url: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!res.ok)
      return { ok: false, error: `HTTP ${res.status} from /api/health` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
