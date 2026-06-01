import { describe, it, expect } from 'vitest';
import {
  buildImageFieldsFromContentTypes,
  collectImageStorageKeys,
  DEFAULT_ASSET_CAPS,
  assertAssetsComplete,
  assertWithinCaps,
} from './assets';
import { BUNDLE_VERSION } from './types';
import type { Bundle } from './types';
import { FIELD_TYPES } from '../../utils/fieldTypes';
import { CONTENT_STATUSES } from '../../utils/contentStatus';

function bundle(): Bundle {
  return {
    version: BUNDLE_VERSION,
    exportedAt: '2026-06-01T00:00:00.000Z',
    portable: false,
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
            type: FIELD_TYPES.ENTRY_TITLE,
            required: true,
            order: 0,
            options: null,
          },
          {
            id: null,
            identifier: 'hero',
            name: 'Hero',
            type: FIELD_TYPES.IMAGE,
            required: false,
            order: 1,
            options: null,
          },
        ],
      },
    ],
    entries: [
      {
        id: null,
        contentTypeId: null,
        contentTypeIdentifier: 'Article',
        entryTitle: 'A',
        entryKey: 'a',
        slug: null,
        versions: [
          {
            status: CONTENT_STATUSES.PUBLISHED,
            data: {
              title: 'A',
              hero: { storageKey: 'k1.png', width: 1, height: 1 },
            },
            publishedAt: null,
          },
          {
            status: CONTENT_STATUSES.DRAFT,
            data: {
              title: 'A',
              hero: { storageKey: 'k2.png', width: 1, height: 1 },
            },
            publishedAt: null,
          },
        ],
      },
      {
        id: null,
        contentTypeId: null,
        contentTypeIdentifier: 'Article',
        entryTitle: 'B',
        entryKey: 'b',
        slug: null,
        versions: [
          {
            status: CONTENT_STATUSES.PUBLISHED,
            data: {
              title: 'B',
              hero: { storageKey: 'k1.png', width: 1, height: 1 },
            },
            publishedAt: null,
          },
        ],
      },
    ],
  };
}

describe('buildImageFieldsFromContentTypes', () => {
  it('maps content-type identifier to its IMAGE field identifiers', () => {
    const map = buildImageFieldsFromContentTypes(bundle().contentTypes!);
    expect(map.get('Article')).toEqual(new Set(['hero']));
  });
});

describe('collectImageStorageKeys', () => {
  it('collects deduped storage keys across all versions', () => {
    const b = bundle();
    const map = buildImageFieldsFromContentTypes(b.contentTypes!);
    const keys = collectImageStorageKeys(b, map);
    expect(keys.sort()).toEqual(['k1.png', 'k2.png']);
  });

  it('returns [] when the bundle has no entries', () => {
    const b = bundle();
    delete b.entries;
    const map = buildImageFieldsFromContentTypes(b.contentTypes!);
    expect(collectImageStorageKeys(b, map)).toEqual([]);
  });

  it('skips null/absent image values and non-image fields', () => {
    const b = bundle();
    b.entries![0]!.versions[0]!.data = { title: 'A', hero: null };
    const map = buildImageFieldsFromContentTypes(b.contentTypes!);
    const keys = collectImageStorageKeys(b, map);
    expect(keys).not.toContain(undefined);
    expect(keys).toContain('k2.png'); // draft version still has k2
  });
});

describe('assertAssetsComplete', () => {
  it('passes when every referenced key is present', () => {
    expect(() =>
      assertAssetsComplete(
        ['k1.png', 'k2.png'],
        new Set(['k1.png', 'k2.png', 'extra.png'])
      )
    ).not.toThrow();
  });

  it('throws naming the first missing key', () => {
    expect(() =>
      assertAssetsComplete(['k1.png', 'k2.png'], new Set(['k1.png']))
    ).toThrow(/k2\.png/);
  });
});

describe('assertWithinCaps', () => {
  it('uses sensible defaults', () => {
    expect(DEFAULT_ASSET_CAPS.perAsset).toBe(25 * 1024 * 1024);
    expect(DEFAULT_ASSET_CAPS.perBundle).toBe(1024 * 1024 * 1024);
  });

  it('throws when a single asset exceeds the per-asset cap', () => {
    expect(() =>
      assertWithinCaps('big.png', 30 * 1024 * 1024, 0, DEFAULT_ASSET_CAPS)
    ).toThrow(/big\.png/);
  });

  it('throws when the running total exceeds the per-bundle cap', () => {
    const caps = { perAsset: 1024, perBundle: 1500 };
    expect(() => assertWithinCaps('a.png', 800, 800, caps)).toThrow(
      /bundle size cap/i
    );
  });

  it('passes within caps', () => {
    expect(() =>
      assertWithinCaps('ok.png', 100, 100, DEFAULT_ASSET_CAPS)
    ).not.toThrow();
  });
});
