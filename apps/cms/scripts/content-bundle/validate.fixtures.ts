// Test-support fixtures for validate.test.ts. NOT a test file (no *.test.ts
// glob match) and NOT vendored. Valid baselines flow through the shared
// builders in ./bundleFactories; deliberately-malformed variants are
// built-then-mutated or kept as bespoke literals. Parity with the original
// inline literals was proven per-fixture with a temporary toStrictEqual
// assertion during extraction.
//
// validateBundle accepts `unknown`, so the deliberately-malformed fixtures are
// left with their inferred object-literal types (no `as Bundle` cast) — the
// original inline literals were likewise untyped and cast to `never` only at
// the (now removed) call site.
import { ct, field, makeBundle } from './bundleFactories';
import type { Bundle, BundleContentType } from './types';
import { BUNDLE_VERSION } from './types';
import { FIELD_TYPES } from '../../utils/fieldTypes';
import {
  CONTENT_STATUSES,
  type ContentStatusName,
} from '../../utils/contentStatus';

/** Content type with a single required ENTRY_TITLE `title` field. */
export const baseContentType: BundleContentType = ct(
  'BlogPost',
  {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    name: 'Blog Post',
  },
  [
    field('title', FIELD_TYPES.ENTRY_TITLE, {
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      name: 'Title',
      required: true,
    }),
  ]
);

/** Minimal valid (non-portable) bundle: one content type, no entries. */
export const validBundle: Bundle = makeBundle({
  exportedAt: '2026-04-14T10:00:00.000Z',
  portable: false,
  contentTypes: [baseContentType],
  entries: [],
});

/** validBundle whose only field is a TEXT field — no ENTRY_TITLE present. */
export const bundleMissingEntryTitle: Bundle = {
  ...validBundle,
  contentTypes: [
    {
      ...baseContentType,
      fields: [field('body', FIELD_TYPES.TEXT, { name: 'Body' })],
    },
  ],
};

/** validBundle with a SELECT field that has empty options (no choices). */
export const bundleSelectWithoutChoices: Bundle = {
  ...validBundle,
  contentTypes: [
    {
      ...baseContentType,
      fields: [
        ...baseContentType.fields,
        field('status', FIELD_TYPES.SELECT, {
          name: 'Status',
          order: 1,
          options: {},
        }),
      ],
    },
  ],
};

/** validBundle with a RELATION field missing target ids/identifiers. */
export const bundleRelationMissingTargets: Bundle = {
  ...validBundle,
  contentTypes: [
    {
      ...baseContentType,
      fields: [
        ...baseContentType.fields,
        field('author', FIELD_TYPES.RELATION, {
          name: 'Author',
          order: 1,
          options: {},
        }),
      ],
    },
  ],
};

/**
 * Portable bundle whose only entry has an empty entryTitle. Bespoke: the entry
 * uses the v1-style flat shape (top-level status/publishedAt/data, no versions
 * array) that the BundleEntry type does not model — left untyped.
 */
export const bundlePortableEmptyEntryTitle = {
  ...validBundle,
  portable: true,
  entries: [
    {
      id: null,
      contentTypeId: null,
      contentTypeIdentifier: 'BlogPost',
      entryTitle: '',
      slug: null,
      status: CONTENT_STATUSES.DRAFT,
      publishedAt: null,
      data: { title: 'x' },
    },
  ],
};

/**
 * Entries-only bundle whose single entry omits entryKey. Bespoke: entries-only
 * (no contentTypes) and references the content type by identifier.
 */
export const bundleEntryMissingEntryKey = {
  version: 2,
  exportedAt: '2026-05-13T00:00:00.000Z',
  portable: true,
  entries: [
    {
      id: null,
      contentTypeId: null,
      contentTypeIdentifier: 'Post',
      entryTitle: 'Hello',
      slug: 'hello',
      versions: [
        { status: CONTENT_STATUSES.PUBLISHED, data: {}, publishedAt: null },
      ],
    },
  ],
};

/** Entries-only bundle whose single entry has an empty-string entryKey. */
export const bundleEntryEmptyEntryKey = {
  version: 2,
  exportedAt: '2026-05-13T00:00:00.000Z',
  portable: true,
  entries: [
    {
      id: null,
      contentTypeId: null,
      contentTypeIdentifier: 'Post',
      entryTitle: 'Hello',
      entryKey: '',
      slug: 'hello',
      versions: [
        { status: CONTENT_STATUSES.PUBLISHED, data: {}, publishedAt: null },
      ],
    },
  ],
};

/** Two entries sharing entryKey "a" within the same contentTypeIdentifier. */
export const bundleDuplicateEntryKey = {
  version: 2,
  exportedAt: '2026-05-13T00:00:00.000Z',
  portable: true,
  entries: [
    {
      id: null,
      contentTypeId: null,
      contentTypeIdentifier: 'Post',
      entryTitle: 'A',
      entryKey: 'a',
      slug: null,
      versions: [
        { status: CONTENT_STATUSES.PUBLISHED, data: {}, publishedAt: null },
      ],
    },
    {
      id: null,
      contentTypeId: null,
      contentTypeIdentifier: 'Post',
      entryTitle: 'B',
      entryKey: 'a',
      slug: null,
      versions: [
        { status: CONTENT_STATUSES.PUBLISHED, data: {}, publishedAt: null },
      ],
    },
  ],
};

/** Same entryKey "shared" across two different contentTypeIdentifiers. */
export const bundleSharedEntryKeyAcrossTypes = {
  version: 2,
  exportedAt: '2026-05-13T00:00:00.000Z',
  portable: true,
  entries: [
    {
      id: null,
      contentTypeId: null,
      contentTypeIdentifier: 'Post',
      entryTitle: 'A',
      entryKey: 'shared',
      slug: null,
      versions: [
        { status: CONTENT_STATUSES.PUBLISHED, data: {}, publishedAt: null },
      ],
    },
    {
      id: null,
      contentTypeId: null,
      contentTypeIdentifier: 'Author',
      entryTitle: 'A',
      entryKey: 'shared',
      slug: null,
      versions: [
        { status: CONTENT_STATUSES.PUBLISHED, data: {}, publishedAt: null },
      ],
    },
  ],
};

/** validBundle claiming the retired bundle version 1. */
export const bundleVersionOne: Bundle = { ...validBundle, version: 1 };

/** validBundle claiming an unsupported future version. */
export const bundleVersionNinetyNine: Bundle = { ...validBundle, version: 99 };

/**
 * validBundle with a v1-style flat entry (top-level status/publishedAt/data, no
 * versions array). Bespoke: the flat entry shape is not modelled by BundleEntry.
 */
export const bundleV1FlatEntry = {
  ...validBundle,
  entries: [
    {
      id: null,
      contentTypeId: null,
      contentTypeIdentifier: 'BlogPost',
      entryTitle: 'Hello',
      entryKey: 'hello',
      slug: null,
      status: 'PUBLISHED',
      publishedAt: null,
      data: { title: 'Hello' },
    },
  ],
};

/** validBundle with a v2-style entry carrying a non-empty versions array. */
export const bundleV2VersionedEntry: Bundle = {
  ...validBundle,
  entries: [
    {
      id: null,
      contentTypeId: null,
      contentTypeIdentifier: 'BlogPost',
      entryTitle: 'Hello',
      entryKey: 'hello',
      slug: null,
      versions: [
        {
          status: CONTENT_STATUSES.PUBLISHED,
          data: { title: 'Hello' },
          publishedAt: null,
        },
      ],
    },
  ],
};

/**
 * Builds a non-portable, entries-only bundle with one Page entry carrying the
 * supplied version statuses (data/publishedAt are fixed). Used to exercise the
 * two-slot invariant. Bespoke: the entries-only shape references the content
 * type by identifier, so the result is left untyped.
 */
export function bundleWithVersions(
  versions: Array<{ status: ContentStatusName }>
) {
  return {
    version: BUNDLE_VERSION,
    exportedAt: '2026-05-30T00:00:00.000Z',
    portable: false,
    entries: [
      {
        id: null,
        contentTypeId: null,
        contentTypeIdentifier: 'Page',
        entryTitle: 'Hello',
        entryKey: 'hello',
        slug: null,
        versions: versions.map((v) => ({
          status: v.status,
          data: {},
          publishedAt: null,
        })),
      },
    ],
  };
}
