import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Bundle } from '../vendor/contentBundleTypes.js';
import { generatePerfData } from './generate.js';
import { CycleRequiresNullError } from './topoSort.js';

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
      expect(e.versions![0]!.status).toBe('PUBLISHED');
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

  it('emits a warning and skips IMAGE fields', () => {
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
              type: 'ENTRY_TITLE',
              required: true,
              unique: true,
              order: 0,
              options: null,
            },
            {
              id: 'f2',
              identifier: 'cover',
              name: 'Cover',
              type: 'IMAGE',
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
      count: 1,
      seed: 1,
    });
    expect(r.warnings.some((w) => /IMAGE/.test(w))).toBe(true);
    expect(r.groups[0]!.entries[0]!.versions![0]!.data.cover).toBeUndefined();
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
              type: 'ENTRY_TITLE',
              required: true,
              unique: true,
              order: 0,
              options: null,
            },
            {
              id: 'f2',
              identifier: 'parent',
              name: 'Parent',
              type: 'RELATION',
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
});
