import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStorage, type Storage } from 'unstorage';
import memoryDriver from 'unstorage/drivers/memory';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountRuntimeStorage } from './runtimeStorage';

// #524 / #528: the cache + image mounts must be built from the env at server
// start, not baked into the build output. These tests drive the mount helper
// against a real unstorage instance (memory/fs/redis drivers, no mocks).

const SAVED_ENV = { ...process.env };
// Nothing listens on port 1, so connects fail fast with ECONNREFUSED.
const UNREACHABLE_REDIS = 'redis://127.0.0.1:1';

let dir: string;
const storages: Storage[] = [];

/** A fresh storage that afterEach disposes (closes the Redis client). */
function newStorage(): Storage {
  const storage = createStorage();
  storages.push(storage);
  return storage;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'runtime-storage-'));
  process.env = { ...SAVED_ENV };
  delete process.env.STORAGE_DRIVER;
  process.env.STORAGE_LOCAL_BASE = dir;
  process.env.REDIS_URL = UNREACHABLE_REDIS;
});

afterEach(async () => {
  await Promise.all(storages.splice(0).map((s) => s.dispose()));
  process.env = { ...SAVED_ENV };
  await rm(dir, { recursive: true, force: true });
});

describe('mountRuntimeStorage', () => {
  it('writes images under STORAGE_LOCAL_BASE as read at call time (#528)', async () => {
    const storage = newStorage();
    mountRuntimeStorage(storage);

    await storage.setItemRaw('images:originals:a.png', Buffer.from('png'));
    await storage.setItemRaw('images:transforms:b.webp', Buffer.from('webp'));

    expect(
      await readFile(join(dir, 'images', 'originals', 'a.png'), 'utf8')
    ).toBe('png');
    expect(
      await readFile(join(dir, 'images', 'transforms', 'b.webp'), 'utf8')
    ).toBe('webp');
  });

  it('mounts the s3 driver when STORAGE_DRIVER=s3 (#528)', () => {
    Object.assign(process.env, {
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'bucket',
      AWS_ACCESS_KEY_ID: 'id',
      AWS_SECRET_ACCESS_KEY: 'secret',
      AWS_REGION: 'eu-west-2',
    });
    const storage = newStorage();
    mountRuntimeStorage(storage);

    expect(storage.getMount('images:originals:x').driver.name).toBe('s3');
    expect(storage.getMount('images:transforms:x').driver.name).toBe('s3');
  });

  it('mounts the cache on redis using REDIS_URL as read at call time (#524)', () => {
    process.env.REDIS_URL = 'redis://cache-host:6380/2';
    const storage = newStorage();
    mountRuntimeStorage(storage);

    const { driver } = storage.getMount('cache:x');
    expect(driver.name).toBe('redis');
    expect((driver.options as { url?: string }).url).toBe(
      'redis://cache-host:6380/2'
    );
  });

  it('replaces mounts that already exist (Nitro dev mounts an fs cache)', () => {
    const storage = newStorage();
    storage.mount('cache', memoryDriver());
    storage.mount('images:originals', memoryDriver());

    expect(() => mountRuntimeStorage(storage)).not.toThrow();
    expect(storage.getMount('cache:x').driver.name).toBe('redis');
    expect(storage.getMount('images:originals:x').driver.name).toBe('fs');
  });

  it('fails a cache read fast when Redis is unreachable (#524)', async () => {
    const storage = newStorage();
    mountRuntimeStorage(storage);

    const started = Date.now();
    await expect(storage.getItem('cache:some-key')).rejects.toThrow();
    // ioredis defaults retry each command 20 times (~20s+). The cache must
    // degrade to "uncached" (withTaggedCache serves BYPASS), not stall.
    expect(Date.now() - started).toBeLessThan(2500);
  });
});
