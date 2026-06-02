// Test-support fixtures for assets.test.ts. NOT a test file (no *.test.ts glob
// match) and NOT vendored. The bundle/content-type DATA flows through the
// shared builders in ./bundleFactories; the storage stubs (in-memory unstorage
// driver, the s3 ArrayBuffer getItemRaw fake) stay inline in the test — they
// are collaborators, not data.
import { ct, entry, field, makeBundle, version } from './bundleFactories';
import type { Bundle } from './types';
import { FIELD_TYPES } from '../../utils/fieldTypes';
import { CONTENT_STATUSES } from '../../utils/contentStatus';

/**
 * Non-portable bundle with one Article content type carrying an IMAGE `hero`
 * field and two entries whose versions reference image storage keys
 * (k1.png / k2.png). Returns a fresh copy per call so tests can mutate it
 * (delete entries, reassign a version's data) in isolation.
 */
export function makeAssetsBundle(): Bundle {
  return makeBundle({
    exportedAt: '2026-06-01T00:00:00.000Z',
    portable: false,
    contentTypes: [
      ct('Article', {}, [
        field('title', FIELD_TYPES.ENTRY_TITLE, {
          name: 'Title',
          required: true,
        }),
        field('hero', FIELD_TYPES.IMAGE, { name: 'Hero', order: 1 }),
      ]),
    ],
    entries: [
      entry('Article', 'a', {
        entryTitle: 'A',
        versions: [
          version(CONTENT_STATUSES.PUBLISHED, {
            data: {
              title: 'A',
              hero: { storageKey: 'k1.png', width: 1, height: 1 },
            },
          }),
          version(CONTENT_STATUSES.DRAFT, {
            data: {
              title: 'A',
              hero: { storageKey: 'k2.png', width: 1, height: 1 },
            },
          }),
        ],
      }),
      entry('Article', 'b', {
        entryTitle: 'B',
        versions: [
          version(CONTENT_STATUSES.PUBLISHED, {
            data: {
              title: 'B',
              hero: { storageKey: 'k1.png', width: 1, height: 1 },
            },
          }),
        ],
      }),
    ],
  });
}
