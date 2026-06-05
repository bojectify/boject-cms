import { describe, it, expect, afterEach } from 'vitest';
import { resolveMeiliConfig, checkMeiliHealth } from './meili';

const ENV_KEYS = ['MEILI_URL', 'MEILI_MASTER_KEY', 'NODE_ENV'] as const;

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(snap: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) {
    if (snap[k] === undefined) Reflect.deleteProperty(process.env, k);
    else process.env[k] = snap[k];
  }
}

describe('resolveMeiliConfig', () => {
  const original = snapshotEnv();
  afterEach(() => restoreEnv(original));

  it('defaults host to localhost:7700 and key to empty when unset', () => {
    delete process.env.MEILI_URL;
    delete process.env.MEILI_MASTER_KEY;
    process.env.NODE_ENV = 'development';
    expect(resolveMeiliConfig()).toEqual({
      host: 'http://localhost:7700',
      apiKey: '',
    });
  });

  it('reads MEILI_URL and MEILI_MASTER_KEY from the environment', () => {
    process.env.MEILI_URL = 'http://search.internal:7700';
    process.env.MEILI_MASTER_KEY = 'secret-key';
    process.env.NODE_ENV = 'development';
    expect(resolveMeiliConfig()).toEqual({
      host: 'http://search.internal:7700',
      apiKey: 'secret-key',
    });
  });

  it('throws in production when MEILI_MASTER_KEY is unset', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.MEILI_MASTER_KEY;
    expect(() => resolveMeiliConfig()).toThrow(/MEILI_MASTER_KEY must be set/);
  });

  it('does not throw in production when MEILI_MASTER_KEY is set', () => {
    process.env.NODE_ENV = 'production';
    process.env.MEILI_MASTER_KEY = 'prod-key';
    expect(resolveMeiliConfig().apiKey).toBe('prod-key');
  });
});

describe('checkMeiliHealth', () => {
  type FakeHealthClient = Parameters<typeof checkMeiliHealth>[0];

  it('returns true when the client reports healthy', async () => {
    // Minimal fake: only isHealthy is exercised; insufficient overlap with the
    // full Meilisearch surface requires the double cast.
    // eslint-disable-next-line no-restricted-syntax
    const fake = { isHealthy: async () => true } as unknown as FakeHealthClient;
    expect(await checkMeiliHealth(fake)).toBe(true);
  });

  it('returns false when the client reports unhealthy', async () => {
    // eslint-disable-next-line no-restricted-syntax
    const fake = {
      isHealthy: async () => false,
    } as unknown as FakeHealthClient;
    expect(await checkMeiliHealth(fake)).toBe(false);
  });

  it('returns false when the client throws', async () => {
    // eslint-disable-next-line no-restricted-syntax
    const fake = {
      isHealthy: async () => {
        throw new Error('connection refused');
      },
    } as unknown as FakeHealthClient;
    expect(await checkMeiliHealth(fake)).toBe(false);
  });

  it('returns false when the probe exceeds the timeout', async () => {
    // eslint-disable-next-line no-restricted-syntax
    const fake = {
      isHealthy: () => new Promise<boolean>(() => {}), // never resolves
    } as unknown as FakeHealthClient;
    expect(await checkMeiliHealth(fake, 10)).toBe(false);
  });
});
