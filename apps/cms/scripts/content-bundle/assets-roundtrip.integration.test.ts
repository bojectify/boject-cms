import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { getTestDatabaseUrl } from '../../test/dbUrl';
import { FIELD_TYPES } from '../../utils/fieldTypes';
import { CONTENT_STATUSES } from '../../utils/contentStatus';
import { exportBundle } from './export';
import { importBundle } from './import';
import {
  createBundleStorage,
  exportAssets,
  importAssets,
  collectImageStorageKeys,
  buildImageFieldsFromContentTypes,
  DEFAULT_ASSET_CAPS,
} from './assets';

const url = getTestDatabaseUrl();
const adapter = new PrismaPg({ connectionString: url });
const prisma = new PrismaClient({ adapter });

let storageRoot: string;
const SAVED = { ...process.env };

async function reset() {
  await prisma.contentEntry.deleteMany();
  await prisma.contentTypeField.deleteMany();
  await prisma.contentType.deleteMany();
}

beforeAll(() => {
  storageRoot = mkdtempSync(join(tmpdir(), 'bundle-storage-'));
  process.env.STORAGE_DRIVER = 'local';
  process.env.STORAGE_LOCAL_BASE = storageRoot;
});
afterAll(async () => {
  process.env = { ...SAVED };
  rmSync(storageRoot, { recursive: true, force: true });
  await prisma.$disconnect();
});
beforeEach(async () => await reset());
afterEach(async () => await reset());

describe('bundle asset round-trip (fs storage)', () => {
  it('exports IMAGE bytes to assets/ and restores them on import', async () => {
    // 1. Seed a content type with an IMAGE field + an entry referencing a key.
    const ct = await prisma.contentType.create({
      data: {
        identifier: 'Article',
        name: 'Article',
        fields: {
          create: [
            {
              identifier: 'title',
              name: 'Title',
              type: FIELD_TYPES.ENTRY_TITLE,
              required: true,
              order: 0,
            },
            {
              identifier: 'hero',
              name: 'Hero',
              type: FIELD_TYPES.IMAGE,
              required: false,
              order: 1,
            },
          ],
        },
      },
    });
    const storageKey = 'roundtrip-key.png';
    await prisma.contentEntry.create({
      data: {
        contentTypeId: ct.id,
        entryTitle: 'Hello',
        entryKey: 'hello',
        slug: null,
        versions: {
          create: {
            status: CONTENT_STATUSES.PUBLISHED,
            entryTitle: 'Hello',
            data: {
              title: 'Hello',
              hero: {
                storageKey,
                mimeType: 'image/png',
                width: 2,
                height: 2,
                fileSize: 3,
              },
            },
            publishedAt: new Date(),
          },
        },
      },
    });

    // 2. Put the bytes into the (temp) originals bucket.
    const storage = createBundleStorage();
    await storage.setItemRaw(storageKey, Buffer.from('PNG'));

    // 3. Export bundle + assets to a temp dir.
    const bundleDir = mkdtempSync(join(tmpdir(), 'bundle-out-'));
    const bundle = await exportBundle(prisma, { mode: 'all', portable: false });
    const imageFields = buildImageFieldsFromContentTypes(bundle.contentTypes!);
    const keys = collectImageStorageKeys(bundle, imageFields);
    expect(keys).toEqual([storageKey]);
    const exp = await exportAssets({
      storage,
      storageKeys: keys,
      assetsDir: join(bundleDir, 'assets'),
      caps: DEFAULT_ASSET_CAPS,
    });
    expect(exp.count).toBe(1);

    // 4. Wipe DB + storage to simulate a fresh target.
    await reset();
    const fresh = createBundleStorage();
    await fresh.removeItem(storageKey);
    expect(await fresh.hasItem(storageKey)).toBe(false);

    // 5. Import bytes then entries.
    const imp = await importAssets({
      storage: fresh,
      assetsDir: join(bundleDir, 'assets'),
    });
    expect(imp.written).toBe(1);
    await importBundle(prisma, bundle, { mode: 'all' });

    // 6. Assert entry + bytes restored.
    const restored = await prisma.contentEntry.findFirst({
      where: { entryKey: 'hello' },
    });
    expect(restored).not.toBeNull();
    expect(await fresh.hasItem(storageKey)).toBe(true);
    expect((await fresh.getItemRaw<Buffer>(storageKey))!.toString()).toBe(
      'PNG'
    );

    rmSync(bundleDir, { recursive: true, force: true });
  });
});
