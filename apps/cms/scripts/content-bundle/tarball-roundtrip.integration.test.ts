import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
  buildImageFieldsFromContentTypes,
  collectImageStorageKeys,
  createBundleStorage,
  importAssetBuffers,
  readBundleAssets,
  DEFAULT_ASSET_CAPS,
} from './assets';
import {
  packBundleTarball,
  unpackBundleTarball,
  looksGzipped,
} from './archive';

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
  storageRoot = mkdtempSync(join(tmpdir(), 'tar-storage-'));
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

async function seedImageEntry(storageKey: string) {
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
}

/** Build a .tar.gz from the current DB state and write it to `file`. */
async function exportTarball(file: string) {
  const bundle = await exportBundle(prisma, { mode: 'all', portable: false });
  const imageFields = buildImageFieldsFromContentTypes(bundle.contentTypes!);
  const keys = collectImageStorageKeys(bundle, imageFields);
  const { assets } = await readBundleAssets({
    storage: createBundleStorage(),
    storageKeys: keys,
    caps: DEFAULT_ASSET_CAPS,
  });
  const tar = await packBundleTarball({
    bundleJson: JSON.stringify(bundle, null, 2),
    assets,
  });
  writeFileSync(file, tar);
  return { bundle };
}

describe('bundle tarball round-trip (fs storage)', () => {
  it('exports a .tar.gz and restores entries + image bytes on import', async () => {
    const storageKey = 'tarball-key.png';
    await seedImageEntry(storageKey);

    const storage = createBundleStorage();
    await storage.setItemRaw(storageKey, Buffer.from('PNG'));

    const dir = mkdtempSync(join(tmpdir(), 'tar-out-'));
    const file = join(dir, 'bundle.tar.gz');
    await exportTarball(file);

    // Sanity: the file is gzipped and unpacks to bundle.json + the asset.
    const raw = readFileSync(file);
    expect(looksGzipped(raw)).toBe(true);
    const unpacked = await unpackBundleTarball(raw);
    expect(unpacked.assetKeys).toEqual([storageKey]);
    expect(unpacked.assets.get(storageKey)!.toString()).toBe('PNG');

    // Wipe DB + storage to simulate a fresh target.
    await reset();
    const fresh = createBundleStorage();
    await fresh.removeItem(storageKey);
    expect(await fresh.hasItem(storageKey)).toBe(false);

    // Import: restore bytes from the archive, then the entries.
    const reloaded = await unpackBundleTarball(readFileSync(file));
    const imp = await importAssetBuffers({
      storage: fresh,
      assets: reloaded.assets,
    });
    expect(imp.written).toBe(1);
    await importBundle(prisma, JSON.parse(reloaded.bundleJson), {
      mode: 'all',
    });

    const restored = await prisma.contentEntry.findFirst({
      where: { entryKey: 'hello' },
    });
    expect(restored).not.toBeNull();
    expect(await fresh.hasItem(storageKey)).toBe(true);
    expect((await fresh.getItemRaw<Buffer>(storageKey))!.toString()).toBe(
      'PNG'
    );

    rmSync(dir, { recursive: true, force: true });
  });

  it('auto-detects a tarball by gzip magic when renamed without a .tar.gz extension', async () => {
    const storageKey = 'renamed-key.png';
    await seedImageEntry(storageKey);
    await createBundleStorage().setItemRaw(storageKey, Buffer.from('IMG'));

    const dir = mkdtempSync(join(tmpdir(), 'tar-out-'));
    const file = join(dir, 'bundle.tar.gz');
    await exportTarball(file);
    const renamed = join(dir, 'bundle.bin');
    renameSync(file, renamed);

    const raw = readFileSync(renamed);
    expect(looksGzipped(raw)).toBe(true); // detection would fire on this buffer
    const unpacked = await unpackBundleTarball(raw);
    expect(unpacked.assetKeys).toEqual([storageKey]);

    rmSync(dir, { recursive: true, force: true });
  });
});
