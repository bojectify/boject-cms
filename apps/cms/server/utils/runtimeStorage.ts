import type { Driver, Storage, StorageValue } from 'unstorage';
import fsDriver from 'unstorage/drivers/fs';
import redisDriver from 'unstorage/drivers/redis';
import s3Driver from 'unstorage/drivers/s3';
import {
  buildStorageConfig,
  type StorageSpec,
} from '../../utils/storageConfig';

/**
 * Mount the cache + image storage from the environment AT SERVER START
 * (#524, #528).
 *
 * These used to live in `nitro.storage` in nuxt.config.ts, which Nitro
 * evaluates when the image is BUILT — so the published image baked in
 * `{ driver: 'redis' }` with no URL (ioredis fell back to localhost) and
 * `./storage/...` fs paths (uploads missed the `/app/storage` volume, and
 * STORAGE_DRIVER=s3/r2 was ignored). Called by the `runtime-storage` Nitro
 * plugin, so the container's env decides, in dev and production alike.
 *
 * Synchronous on purpose: Nitro doesn't await plugins, and every mount must
 * exist before the first request.
 */
export function mountRuntimeStorage<T extends StorageValue>(
  storage: Storage<T>
): void {
  for (const [base, spec] of Object.entries(buildStorageConfig())) {
    replaceMount(storage, base, driverFromSpec(spec));
  }
  replaceMount(storage, 'cache', createCacheDriver(process.env.REDIS_URL));
}

/**
 * ioredis options for the cache client. Caching is never a correctness
 * dependency (withTaggedCache serves `X-Cache: BYPASS` on a read error), so
 * an unreachable Redis must fail a command in about a second rather than
 * after ioredis's default 20 per-command retries (~20s per request).
 */
const CACHE_REDIS_OPTIONS = {
  maxRetriesPerRequest: 1,
  connectTimeout: 1000,
  commandTimeout: 1000,
} as const;

function createCacheDriver(url: string | undefined): Driver {
  const driver = redisDriver({ url, ...CACHE_REDIS_OPTIONS });
  attachErrorLogging(driver);
  return driver;
}

/**
 * Replace ioredis's "Unhandled error event" (logged every reconnect attempt,
 * ~every 2s, for as long as Redis is down) with one warning per outage.
 */
function attachErrorLogging(driver: Driver): void {
  const client = driver.getInstance?.() as
    | {
        on(event: 'error', fn: (err: Error) => void): unknown;
        on(event: 'ready', fn: () => void): unknown;
      }
    | undefined;
  if (!client) return;
  let warned = false;
  client.on('error', (err) => {
    if (warned) return;
    warned = true;
    console.warn(
      `[cache] Redis unavailable, serving uncached until it recovers: ${err.message}`
    );
  });
  client.on('ready', () => {
    warned = false;
  });
}

function driverFromSpec(spec: StorageSpec[string]): Driver {
  const { driver, ...opts } = spec;
  if (driver === 'fs') return fsDriver({ base: opts.base as string });
  if (driver === 's3') {
    // The spec is a loose Record<string, unknown> whose keys match
    // S3DriverOptions exactly (see buildStorageConfig); same bridge as
    // scripts/content-bundle/assets.ts::createBundleStorage.
    // eslint-disable-next-line no-restricted-syntax -- spec is Record<string, unknown>; no structural overlap with S3DriverOptions
    return s3Driver(opts as unknown as Parameters<typeof s3Driver>[0]);
  }
  throw new Error(`Unsupported storage driver "${driver}"`);
}

/**
 * unstorage's `mount` throws if the base is already mounted (Nitro dev mounts
 * a default fs `cache`). `unmount(base, false)` skips disposal, so it never
 * awaits and removes the mount synchronously before `mount` runs.
 */
function replaceMount<T extends StorageValue>(
  storage: Storage<T>,
  base: string,
  driver: Driver
): void {
  void storage.unmount(base, false);
  storage.mount(base, driver);
}
