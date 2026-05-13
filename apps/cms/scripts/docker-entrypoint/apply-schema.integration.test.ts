import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { applySchema } from '../content-bundle/applySchema';
import { SchemaApplyBlockedError } from '../content-bundle/applySchemaErrors';
import { applySchemaIfConfigured } from './apply-schema';

const url = 'postgresql://boject:boject@localhost:5432/boject_test';
const adapter = new PrismaPg({ connectionString: url });
const prisma = new PrismaClient({ adapter });

const NOOP_LOGGER = { info: () => {}, error: () => {} };

const ARTICLE_BUNDLE = {
  version: 2 as const,
  exportedAt: '2026-05-01T00:00:00.000Z',
  portable: true as const,
  contentTypes: [
    {
      id: null,
      identifier: 'Article',
      name: 'Article',
      description: null,
      fields: [
        {
          id: null,
          identifier: 'title',
          name: 'Title',
          type: 'ENTRY_TITLE' as const,
          required: true,
          order: 0,
          options: null,
        },
      ],
    },
  ],
};

const ARTICLE_BUNDLE_WITH_TAGLINE = {
  ...ARTICLE_BUNDLE,
  contentTypes: [
    {
      ...ARTICLE_BUNDLE.contentTypes[0]!,
      fields: [
        ...ARTICLE_BUNDLE.contentTypes[0]!.fields,
        {
          id: null,
          identifier: 'tagline',
          name: 'Tagline',
          type: 'TEXT' as const,
          required: false,
          order: 1,
          options: null,
        },
      ],
    },
  ],
};

const EMPTY_BUNDLE = {
  version: 2 as const,
  exportedAt: '2026-05-01T00:00:00.000Z',
  portable: true as const,
  contentTypes: [],
};

async function reset() {
  await prisma.contentEntry.deleteMany();
  await prisma.contentTypeField.deleteMany();
  await prisma.contentType.deleteMany();
}

async function makeDir(files: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'apply-schema-'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), JSON.stringify(content), 'utf8');
  }
  return dir;
}

const tempDirs: string[] = [];
async function tempDir(files: Record<string, unknown>): Promise<string> {
  const d = await makeDir(files);
  tempDirs.push(d);
  return d;
}

describe('apply-schema (integration)', () => {
  beforeEach(async () => {
    await reset();
  });

  afterAll(async () => {
    await reset();
    for (const d of tempDirs) await rm(d, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  it('applies a schema bundle to an empty DB', async () => {
    const dir = await tempDir({
      'schema.boject.json': ARTICLE_BUNDLE,
    });

    const result = await applySchemaIfConfigured(prisma, {
      dirPath: dir,
      allowDestructive: false,
      applySchemaFn: applySchema,
      readDir: (p) => readdir(p),
      readFile: (p) => readFile(p, 'utf8'),
      logger: NOOP_LOGGER,
    });

    expect(result.applied).toBe(true);
    expect(result.files).toBe(1);
    expect(result.totalChanges).toBeGreaterThan(0);

    const ct = await prisma.contentType.findUnique({
      where: { identifier: 'Article' },
      include: { fields: true },
    });
    expect(ct).not.toBeNull();
    expect(ct!.fields).toHaveLength(1);
  });

  it('is a no-op when the bundle matches current state', async () => {
    const dir = await tempDir({
      'schema.boject.json': ARTICLE_BUNDLE,
    });
    await applySchemaIfConfigured(prisma, {
      dirPath: dir,
      allowDestructive: false,
      applySchemaFn: applySchema,
      readDir: (p) => readdir(p),
      readFile: (p) => readFile(p, 'utf8'),
      logger: NOOP_LOGGER,
    });

    const result = await applySchemaIfConfigured(prisma, {
      dirPath: dir,
      allowDestructive: false,
      applySchemaFn: applySchema,
      readDir: (p) => readdir(p),
      readFile: (p) => readFile(p, 'utf8'),
      logger: NOOP_LOGGER,
    });

    expect(result.applied).toBe(true);
    expect(result.totalChanges).toBe(0);
  });

  it('applies a diff (add field) when the bundle is updated', async () => {
    const initialDir = await tempDir({
      'schema.boject.json': ARTICLE_BUNDLE,
    });
    await applySchemaIfConfigured(prisma, {
      dirPath: initialDir,
      allowDestructive: false,
      applySchemaFn: applySchema,
      readDir: (p) => readdir(p),
      readFile: (p) => readFile(p, 'utf8'),
      logger: NOOP_LOGGER,
    });

    const updatedDir = await tempDir({
      'schema.boject.json': ARTICLE_BUNDLE_WITH_TAGLINE,
    });
    const result = await applySchemaIfConfigured(prisma, {
      dirPath: updatedDir,
      allowDestructive: false,
      applySchemaFn: applySchema,
      readDir: (p) => readdir(p),
      readFile: (p) => readFile(p, 'utf8'),
      logger: NOOP_LOGGER,
    });

    expect(result.totalChanges).toBe(1);
    const tagline = await prisma.contentTypeField.findFirst({
      where: { identifier: 'tagline' },
    });
    expect(tagline).not.toBeNull();
  });

  it('refuses without allowDestructive when removing a type with entries', async () => {
    const dir = await tempDir({
      'schema.boject.json': ARTICLE_BUNDLE,
    });
    await applySchemaIfConfigured(prisma, {
      dirPath: dir,
      allowDestructive: false,
      applySchemaFn: applySchema,
      readDir: (p) => readdir(p),
      readFile: (p) => readFile(p, 'utf8'),
      logger: NOOP_LOGGER,
    });
    const ct = await prisma.contentType.findUniqueOrThrow({
      where: { identifier: 'Article' },
    });
    await prisma.contentEntry.create({
      data: {
        contentTypeId: ct.id,
        entryTitle: 'X',
        entryKey: 'x',
        slug: 'x',
        versions: {
          create: {
            data: { title: 'X' },
            entryTitle: 'X',
            status: 'PUBLISHED',
          },
        },
      },
    });

    const removalDir = await tempDir({
      'schema.boject.json': EMPTY_BUNDLE,
    });
    await expect(
      applySchemaIfConfigured(prisma, {
        dirPath: removalDir,
        allowDestructive: false,
        applySchemaFn: applySchema,
        readDir: (p) => readdir(p),
        readFile: (p) => readFile(p, 'utf8'),
        logger: NOOP_LOGGER,
      })
    ).rejects.toBeInstanceOf(SchemaApplyBlockedError);

    const stillThere = await prisma.contentType.findUnique({
      where: { identifier: 'Article' },
    });
    expect(stillThere).not.toBeNull();
  });

  it('applies the removal with allowDestructive (no entries)', async () => {
    const dir = await tempDir({
      'schema.boject.json': ARTICLE_BUNDLE,
    });
    await applySchemaIfConfigured(prisma, {
      dirPath: dir,
      allowDestructive: false,
      applySchemaFn: applySchema,
      readDir: (p) => readdir(p),
      readFile: (p) => readFile(p, 'utf8'),
      logger: NOOP_LOGGER,
    });

    const removalDir = await tempDir({
      'schema.boject.json': EMPTY_BUNDLE,
    });
    const result = await applySchemaIfConfigured(prisma, {
      dirPath: removalDir,
      allowDestructive: true,
      applySchemaFn: applySchema,
      readDir: (p) => readdir(p),
      readFile: (p) => readFile(p, 'utf8'),
      logger: NOOP_LOGGER,
    });

    expect(result.totalChanges).toBe(1);
    const gone = await prisma.contentType.findUnique({
      where: { identifier: 'Article' },
    });
    expect(gone).toBeNull();
  });
});
