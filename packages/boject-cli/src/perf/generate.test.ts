import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Bundle } from '../vendor/contentBundleTypes.js';
import { generatePerfData } from './generate.js';
import { CycleRequiresNullError } from './topoSort.js';
import { FIELD_TYPES } from '../vendor/fieldTypes.js';
import { CONTENT_STATUSES } from '../vendor/contentStatus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function loadFixture(name: string): Promise<Bundle> {
  const path = join(__dirname, 'fixtures', `${name}.bundle.json`);
  return JSON.parse(await readFile(path, 'utf8')) as Bundle;
}

describe('generatePerfData', () => {
  it('produces N entries with PUBLISHED versions for the requested type', async () => {
    const bundle = await loadFixture('minimal');
    const r = generatePerfData(bundle, {
      contentTypeIdentifier: 'Page',
      count: 5,
      seed: 1,
    });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]!.contentTypeIdentifier).toBe('Page');
    expect(r.groups[0]!.entries).toHaveLength(5);
    for (const e of r.groups[0]!.entries) {
      expect(e.versions).toHaveLength(1);
      expect(e.versions![0]!.status).toBe(CONTENT_STATUSES.PUBLISHED);
    }
  });

  it('emits ENTRY_TITLE values into entry.entryTitle and version.data', async () => {
    const bundle = await loadFixture('minimal');
    const r = generatePerfData(bundle, {
      contentTypeIdentifier: 'Page',
      count: 1,
      seed: 1,
    });
    const e = r.groups[0]!.entries[0]!;
    expect(typeof e.entryTitle).toBe('string');
    expect(e.entryTitle.length).toBeGreaterThan(0);
    expect(e.versions![0]!.data.title).toBe(e.entryTitle);
  });

  it('emits SLUG values into entry.slug', async () => {
    const bundle = await loadFixture('minimal');
    const r = generatePerfData(bundle, {
      contentTypeIdentifier: 'Page',
      count: 1,
      seed: 1,
    });
    const e = r.groups[0]!.entries[0]!;
    expect(e.slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('seeds dependency types before the dependent type (topo order)', async () => {
    const bundle = await loadFixture('with-relations');
    const r = generatePerfData(bundle, {
      contentTypeIdentifier: 'Article',
      count: 10,
      seed: 1,
    });
    expect(r.groups.map((g) => g.contentTypeIdentifier)).toEqual([
      'Author',
      'Article',
    ]);
    expect(r.groups[0]!.entries.length).toBeGreaterThan(0);
    expect(r.groups[1]!.entries).toHaveLength(10);
  });

  it('sizes dependency targets at min(count, 200)', async () => {
    const bundle = await loadFixture('with-relations');
    const small = generatePerfData(bundle, {
      contentTypeIdentifier: 'Article',
      count: 50,
      seed: 1,
    });
    expect(small.groups[0]!.entries).toHaveLength(50); // count < 200

    const big = generatePerfData(bundle, {
      contentTypeIdentifier: 'Article',
      count: 1000,
      seed: 1,
    });
    expect(big.groups[0]!.entries).toHaveLength(200); // capped
  });

  it('populates RELATION fields with refs from the target type', async () => {
    const bundle = await loadFixture('with-relations');
    const r = generatePerfData(bundle, {
      contentTypeIdentifier: 'Article',
      count: 5,
      seed: 1,
    });
    const authorIds = new Set(r.groups[0]!.entries.map((e) => e.id));
    for (const article of r.groups[1]!.entries) {
      const ref = article.versions![0]!.data.author as {
        entryId: string;
        contentTypeId: string;
        contentTypeIdentifier: string;
      };
      expect(authorIds.has(ref.entryId)).toBe(true);
      expect(ref.contentTypeIdentifier).toBe('Author');
    }
  });

  it('produces deterministic output for the same seed', async () => {
    const bundle = await loadFixture('with-relations');
    const a = generatePerfData(bundle, {
      contentTypeIdentifier: 'Article',
      count: 3,
      seed: 42,
    });
    const b = generatePerfData(bundle, {
      contentTypeIdentifier: 'Article',
      count: 3,
      seed: 42,
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('synthesises populated IMAGE field values', () => {
    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-07T00:00:00.000Z',
      portable: false,
      contentTypes: [
        {
          id: 'ct-page',
          identifier: 'Page',
          name: 'Page',
          description: null,
          fields: [
            {
              id: 'f1',
              identifier: 'title',
              name: 'Title',
              type: FIELD_TYPES.ENTRY_TITLE,
              required: true,
              unique: true,
              order: 0,
              options: null,
            },
            {
              id: 'f2',
              identifier: 'cover',
              name: 'Cover',
              type: FIELD_TYPES.IMAGE,
              required: false,
              order: 1,
              options: null,
            },
          ],
        },
      ],
    };
    const r = generatePerfData(bundle, {
      contentTypeIdentifier: 'Page',
      count: 3,
      seed: 1,
    });
    // No IMAGE-related warnings should appear.
    expect(r.warnings.some((w) => /IMAGE/.test(w))).toBe(false);
    // Every entry's IMAGE field is populated with the ImageFile shape.
    for (const entry of r.groups[0]!.entries) {
      const cover = entry.versions![0]!.data.cover as Record<string, unknown>;
      expect(cover).toBeDefined();
      expect(cover.mimeType).toBe('image/jpeg');
      expect(cover.storageKey).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(cover.focalPointX).toBe(0.5);
      expect(cover.focalPointY).toBe(0.5);
      expect(typeof cover.width).toBe('number');
      expect(typeof cover.height).toBe('number');
      expect(typeof cover.fileSize).toBe('number');
      expect(typeof cover.originalName).toBe('string');
    }
  });

  it('handles an optional self-relation cycle via patches', async () => {
    const bundle = await loadFixture('with-cycle');
    const r = generatePerfData(bundle, {
      contentTypeIdentifier: 'Page',
      count: 5,
      seed: 1,
    });
    expect(r.groups[0]!.patches).toBeDefined();
    expect(r.groups[0]!.patches!.length).toBeGreaterThan(0);
    // First-pass entries do NOT carry parent in their data
    for (const e of r.groups[0]!.entries) {
      expect(e.versions![0]!.data.parent).toBeUndefined();
    }
  });

  it('throws CycleRequiresNullError on a required cycle', () => {
    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-07T00:00:00.000Z',
      portable: false,
      contentTypes: [
        {
          id: 'ct-page',
          identifier: 'Page',
          name: 'Page',
          description: null,
          fields: [
            {
              id: 'f1',
              identifier: 'title',
              name: 'Title',
              type: FIELD_TYPES.ENTRY_TITLE,
              required: true,
              unique: true,
              order: 0,
              options: null,
            },
            {
              id: 'f2',
              identifier: 'parent',
              name: 'Parent',
              type: FIELD_TYPES.RELATION,
              required: true,
              order: 1,
              options: { targetContentTypeIds: ['ct-page'] },
            },
          ],
        },
      ],
    };
    expect(() =>
      generatePerfData(bundle, {
        contentTypeIdentifier: 'Page',
        count: 5,
        seed: 1,
      })
    ).toThrow(CycleRequiresNullError);
  });

  it('throws when contentTypeIdentifier is unknown', async () => {
    const bundle = await loadFixture('minimal');
    expect(() =>
      generatePerfData(bundle, {
        contentTypeIdentifier: 'Nope',
        count: 1,
        seed: 1,
      })
    ).toThrow(/Nope/);
  });

  it('generates dependent content types when given a portable bundle', async () => {
    const bundle = await loadFixture('with-relations-portable');
    const r = generatePerfData(bundle, {
      contentTypeIdentifier: 'Article',
      count: 5,
      seed: 1,
    });
    // Both Author and Article groups should be present — Article depends on Author via relation
    const groupIdentifiers = r.groups.map((g) => g.contentTypeIdentifier);
    expect(groupIdentifiers).toContain('Article');
    expect(groupIdentifiers).toContain('Author');
    // Author group must have at least one entry so Article's required `author` relation can populate
    const authorGroup = r.groups.find(
      (g) => g.contentTypeIdentifier === 'Author'
    );
    expect(authorGroup).toBeDefined();
    expect(authorGroup!.entries.length).toBeGreaterThan(0);
  });

  it('populates RELATION field values from the dependency pool when given a portable bundle', async () => {
    const bundle = await loadFixture('with-relations-portable');
    const r = generatePerfData(bundle, {
      contentTypeIdentifier: 'Article',
      count: 5,
      seed: 1,
    });
    const authorGroup = r.groups.find(
      (g) => g.contentTypeIdentifier === 'Author'
    );
    expect(authorGroup).toBeDefined();
    const authorIds = new Set(authorGroup!.entries.map((e) => e.id));
    const articleGroup = r.groups.find(
      (g) => g.contentTypeIdentifier === 'Article'
    );
    expect(articleGroup).toBeDefined();
    // `author` is required RELATION — every Article entry must reference a generated Author
    for (const article of articleGroup!.entries) {
      const authorRef = article.versions![0]!.data.author as {
        contentTypeIdentifier: string;
        entryId: string;
      } | null;
      expect(authorRef).not.toBeNull();
      expect(authorRef!.contentTypeIdentifier).toBe('Author');
      expect(authorIds.has(authorRef!.entryId)).toBe(true);
    }
  });
});

describe('generatePerfData entryKey (#205)', () => {
  it('emits entryKey via slugify(entryTitle) on every entry', async () => {
    const bundle = await loadFixture('minimal');
    const r = generatePerfData(bundle, {
      contentTypeIdentifier: 'Page',
      count: 5,
      seed: 42,
    });
    for (const e of r.groups[0]!.entries) {
      expect(e.entryKey).toBeTruthy();
      expect(e.entryKey).toBe(
        e.entryTitle
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
      );
    }
  });

  it('produces unique entryKeys across the generated batch', async () => {
    const bundle = await loadFixture('minimal');
    const r = generatePerfData(bundle, {
      contentTypeIdentifier: 'Page',
      count: 50,
      seed: 99,
    });
    const keys = new Set<string>();
    for (const e of r.groups[0]!.entries) keys.add(e.entryKey);
    expect(keys.size).toBe(r.groups[0]!.entries.length);
  });

  it('emits entryKey on entries from dependency groups too', async () => {
    const bundle = await loadFixture('with-relations');
    const r = generatePerfData(bundle, {
      contentTypeIdentifier: 'Article',
      count: 5,
      seed: 1,
    });
    for (const group of r.groups) {
      for (const e of group.entries) {
        expect(e.entryKey).toBeTruthy();
        expect(e.entryKey).toBe(
          e.entryTitle
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
        );
      }
    }
  });
});

describe('generatePerfData uniqueness at scale', () => {
  it('produces unique entry IDs across 5000 entries (no PRNG-period collisions)', async () => {
    const bundle = await loadFixture('minimal');
    const r = generatePerfData(bundle, {
      contentTypeIdentifier: 'Page',
      count: 5000,
      seed: 1,
    });
    const ids = r.groups[0]!.entries.map((e) => e.id!);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('produces unique entry IDs across multiple groups in a 1000-entry run', async () => {
    const bundle = await loadFixture('with-relations');
    const r = generatePerfData(bundle, {
      contentTypeIdentifier: 'Article',
      count: 1000,
      seed: 1,
    });
    // Combine IDs from all groups (Authors + Articles); they live in
    // separate Postgres tables but the perf seeder MUST not produce
    // duplicates because writers expect distinct primary keys per row.
    const ids: string[] = [];
    for (const g of r.groups) for (const e of g.entries) ids.push(e.id!);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});
