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
 * Probe `k6 --version` and parse the semver. Spawns with the same 5-second
 * timeout as `defaultK6Available`. Returns `'unknown'` on any failure
 * (binary missing, timeout, parse miss) — never throws.
 */
export async function defaultK6Version(): Promise<string> {
  return new Promise((resolveResult) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('k6', ['version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      resolveResult('unknown');
      return;
    }
    let buf = '';
    let resolved = false;
    const done = (value: string) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolveResult(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      done('unknown');
    }, K6_VERSION_TIMEOUT_MS);
    child.stdout?.on('data', (b: Buffer) => {
      buf += b.toString();
    });
    child.on('error', () => done('unknown'));
    child.on('close', () => {
      const m = buf.match(/k6 v([\d.]+)/);
      done(m ? m[1]! : 'unknown');
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
