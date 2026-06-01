import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildStorageConfig } from './storageConfig';

const SAVED = { ...process.env };

describe('buildStorageConfig', () => {
  beforeEach(() => {
    delete process.env.STORAGE_DRIVER;
    delete process.env.STORAGE_LOCAL_BASE;
  });
  afterEach(() => {
    process.env = { ...SAVED };
  });

  it('defaults to the local fs driver under /app/storage', () => {
    const spec = buildStorageConfig();
    expect(spec['images:originals']).toEqual({
      driver: 'fs',
      base: '/app/storage/images/originals',
    });
    expect(spec['images:transforms']).toEqual({
      driver: 'fs',
      base: '/app/storage/images/transforms',
    });
  });

  it('honours STORAGE_LOCAL_BASE', () => {
    process.env.STORAGE_LOCAL_BASE = '/tmp/x';
    expect(buildStorageConfig()['images:originals']).toEqual({
      driver: 'fs',
      base: '/tmp/x/images/originals',
    });
  });

  it('builds an s3 spec with a pathPrefix', () => {
    process.env.STORAGE_DRIVER = 's3';
    process.env.S3_BUCKET = 'b';
    process.env.AWS_REGION = 'eu-west-2';
    process.env.AWS_ACCESS_KEY_ID = 'k';
    process.env.AWS_SECRET_ACCESS_KEY = 's';
    const spec = buildStorageConfig();
    expect(spec['images:originals']).toMatchObject({
      driver: 's3',
      bucket: 'b',
      region: 'eu-west-2',
      pathPrefix: 'images/originals/',
    });
  });

  it('throws on an unsupported driver', () => {
    process.env.STORAGE_DRIVER = 'floppy';
    expect(() => buildStorageConfig()).toThrow(/Unsupported STORAGE_DRIVER/);
  });

  it('throws when a required s3 env var is missing', () => {
    process.env.STORAGE_DRIVER = 's3';
    expect(() => buildStorageConfig()).toThrow(/Missing required env var/);
  });
});
