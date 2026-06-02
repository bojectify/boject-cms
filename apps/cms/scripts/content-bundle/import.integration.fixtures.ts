// Test-support fixtures for import.integration.test.ts. NOT a test file (no
// *.test.ts glob match) and NOT vendored. Built via ./bundleFactories so the
// import-path coverage (portable two-pass, on-conflict modes, dangling-ref
// guard) reads as bundle shape rather than nested literal noise.
//
// `exportedAt` is not uniform across these bundles (the originals carry three
// distinct timestamps), so each fixture passes its own — there is no single
// FIXED_EXPORTED_AT default here. Fixtures whose entry/contentType ids are
// per-test `randomUUID()` values are exported as FACTORY FUNCTIONS taking the
// ids as parameters: baking a fresh uuid into a module const would compute one
// id at import time and share it across every test.
import { randomUUID } from 'node:crypto';
import type { Bundle } from './types';
import { FIELD_TYPES } from '../../utils/fieldTypes';
import { CONTENT_STATUSES } from '../../utils/contentStatus';
import { ct, entry, field, makeBundle, version } from './bundleFactories';

const APR_14 = '2026-04-14T10:00:00.000Z';
const MAY_13 = '2026-05-13T10:00:00.000Z';
const MAY_30 = '2026-05-30T00:00:00.000Z';

// --- Portable schema-only + entry bundles (April timestamp) ---

/** A portable schema-only bundle: one BlogPost type (ENTRY_TITLE + TEXTAREA). */
export const schemaOnly: Bundle = makeBundle({
  exportedAt: APR_14,
  contentTypes: [
    ct('BlogPost', { name: 'Blog Post' }, [
      field('title', FIELD_TYPES.ENTRY_TITLE, {
        name: 'Title',
        required: true,
      }),
      field('body', FIELD_TYPES.TEXTAREA, { name: 'Body', order: 1 }),
    ]),
  ],
});

/** Portable bundle: a Category type + a BlogPost type whose RELATION field
 *  targets Category by identifier, plus two entries (News + a Hello post that
 *  references News via entryKey). Exercises two-pass relation resolution. */
export const withRelations: Bundle = makeBundle({
  exportedAt: APR_14,
  contentTypes: [
    ct('Category', {}, [
      field('name', FIELD_TYPES.ENTRY_TITLE, { name: 'Name', required: true }),
    ]),
    ct('BlogPost', { name: 'Blog Post' }, [
      field('title', FIELD_TYPES.ENTRY_TITLE, {
        name: 'Title',
        required: true,
      }),
      field('category', FIELD_TYPES.RELATION, {
        name: 'Category',
        order: 1,
        options: {
          targetContentTypeIds: [null],
          targetContentTypeIdentifiers: ['Category'],
        },
      }),
    ]),
  ],
  entries: [
    entry('Category', 'news', {
      entryTitle: 'News',
      slug: 'news',
      versions: [
        version(CONTENT_STATUSES.PUBLISHED, { data: { name: 'News' } }),
      ],
    }),
    entry('BlogPost', 'hello', {
      entryTitle: 'Hello',
      slug: 'hello',
      versions: [
        version(CONTENT_STATUSES.DRAFT, {
          data: {
            title: 'Hello',
            category: { contentTypeIdentifier: 'Category', entryKey: 'news' },
          },
        }),
      ],
    }),
  ],
});

/** Portable schema-only bundle whose TypeA MULTIRELATION forward-references
 *  TypeB, declared later in the bundle. */
export const forwardRef: Bundle = makeBundle({
  exportedAt: APR_14,
  contentTypes: [
    ct('TypeA', { name: 'Type A' }, [
      field('title', FIELD_TYPES.ENTRY_TITLE, {
        name: 'Title',
        required: true,
      }),
      field('bs', FIELD_TYPES.MULTIRELATION, {
        name: 'Bs',
        order: 1,
        options: {
          targetContentTypeIds: [null],
          targetContentTypeIdentifiers: ['TypeB'],
        },
      }),
    ]),
    ct('TypeB', { name: 'Type B' }, [
      field('title', FIELD_TYPES.ENTRY_TITLE, {
        name: 'Title',
        required: true,
      }),
    ]),
  ],
});

/** Portable schema-only bundle whose RELATION field targets a content type
 *  identifier that is never declared — drives the unknown-target error. */
export const danglingRef: Bundle = makeBundle({
  exportedAt: APR_14,
  contentTypes: [
    ct('Orphan', {}, [
      field('title', FIELD_TYPES.ENTRY_TITLE, {
        name: 'Title',
        required: true,
      }),
      field('ref', FIELD_TYPES.RELATION, {
        name: 'Ref',
        order: 1,
        options: {
          targetContentTypeIds: [null],
          targetContentTypeIdentifiers: ['DoesNotExist'],
        },
      }),
    ]),
  ],
});

// --- entryKey-on-import bundles (#205, May 13 timestamp) ---

/** Portable schema-only bundle with a single KeyedType (one ENTRY_TITLE).
 *  Reused as the base for the entryKey-handling entry bundles below. */
export const baseTypeBundle: Bundle = makeBundle({
  exportedAt: MAY_13,
  contentTypes: [
    ct('KeyedType', {}, [
      field('title', FIELD_TYPES.ENTRY_TITLE, {
        name: 'Title',
        required: true,
      }),
    ]),
  ],
});

/** baseTypeBundle plus an entry that OMITS entryKey — drives the rejection.
 *  The entry is the pre-#205 flat shape (status/publishedAt/data on the entry,
 *  no versions array), so it is typed loosely and cast to `never` at the call
 *  site; built as a plain object, not via the entry() builder. */
export const missingEntryKeyBundle = {
  ...baseTypeBundle,
  entries: [
    {
      id: null,
      contentTypeId: null,
      contentTypeIdentifier: 'KeyedType',
      entryTitle: 'Imported',
      // entryKey intentionally missing
      slug: 'imported',
      status: CONTENT_STATUSES.DRAFT,
      publishedAt: null,
      data: { title: 'Imported' },
    },
  ],
};

/** baseTypeBundle plus a well-formed entry carrying an explicit entryKey. */
export const writesEntryKeyBundle: Bundle = {
  ...baseTypeBundle,
  entries: [
    entry('KeyedType', 'imported-key', {
      entryTitle: 'Imported',
      slug: 'imported',
      versions: [
        version(CONTENT_STATUSES.DRAFT, { data: { title: 'Imported' } }),
      ],
    }),
  ],
};

/** Portable bundle: Category + Post types where Post.category RELATION targets
 *  Category, plus a News category and a Hello post referencing it by entryKey.
 *  Like withRelations but with distinct slugs to prove entryKey resolution. */
export const portableRelByEntryKeyBundle: Bundle = makeBundle({
  exportedAt: MAY_13,
  contentTypes: [
    ct('Category', {}, [
      field('name', FIELD_TYPES.ENTRY_TITLE, { name: 'Name', required: true }),
    ]),
    ct('Post', {}, [
      field('title', FIELD_TYPES.ENTRY_TITLE, {
        name: 'Title',
        required: true,
      }),
      field('category', FIELD_TYPES.RELATION, {
        name: 'Category',
        order: 1,
        options: {
          targetContentTypeIds: [null],
          targetContentTypeIdentifiers: ['Category'],
        },
      }),
    ]),
  ],
  entries: [
    entry('Category', 'news', {
      entryTitle: 'News',
      slug: 'news-cat',
      versions: [
        version(CONTENT_STATUSES.PUBLISHED, { data: { name: 'News' } }),
      ],
    }),
    entry('Post', 'hello', {
      entryTitle: 'Hello',
      slug: 'hello-post',
      versions: [
        version(CONTENT_STATUSES.DRAFT, {
          data: {
            title: 'Hello',
            category: { contentTypeIdentifier: 'Category', entryKey: 'news' },
          },
        }),
      ],
    }),
  ],
});

/** baseTypeBundle plus a Foo entry (entryKey 'foo') — the first import in the
 *  conflicting-entryKey test. */
export const conflictKeyFirstBundle: Bundle = {
  ...baseTypeBundle,
  entries: [
    entry('KeyedType', 'foo', {
      entryTitle: 'Foo',
      slug: 'foo',
      versions: [version(CONTENT_STATUSES.DRAFT, { data: { title: 'Foo' } })],
    }),
  ],
};

/** Entries-only portable bundle reusing entryKey 'foo' against the existing
 *  KeyedType — the second import that must collide. */
export const conflictKeySecondBundle: Bundle = makeBundle({
  exportedAt: MAY_13,
  entries: [
    entry('KeyedType', 'foo', {
      entryTitle: 'Foo II',
      slug: 'foo-2',
      versions: [
        version(CONTENT_STATUSES.DRAFT, { data: { title: 'Foo II' } }),
      ],
    }),
  ],
});

// --- on-conflict skip / replace / dry-run bundles (May 30 timestamp) ---

/** Non-portable entries-only bundle: a PageSkipTest entry whose entryKey
 *  ('original-title') collides with a seeded row — used with onConflict skip. */
export const skipConflictBundle: Bundle = makeBundle({
  exportedAt: MAY_30,
  portable: false,
  entries: [
    entry('PageSkipTest', 'original-title', {
      entryTitle: 'Conflicting Title',
      versions: [
        version(CONTENT_STATUSES.PUBLISHED, {
          data: { title: 'Conflicting Title' },
          publishedAt: MAY_30,
        }),
      ],
    }),
  ],
});

/** Non-portable entries-only bundle: a PageReplaceTest entry colliding on
 *  entryKey 'replace-target' — used with onConflict replace. */
export const replaceConflictBundle: Bundle = makeBundle({
  exportedAt: MAY_30,
  portable: false,
  entries: [
    entry('PageReplaceTest', 'replace-target', {
      entryTitle: 'Replaced',
      slug: 'replaced-slug',
      versions: [
        version(CONTENT_STATUSES.PUBLISHED, {
          data: { title: 'Replaced' },
          publishedAt: MAY_30,
        }),
      ],
    }),
  ],
});

/** Portable entries-only bundle: an AuthorReplaceTest entry colliding on
 *  entryKey 'olly' plus an ArticleReplaceTest entry whose RELATION references
 *  it by entryKey — proves replace resolves to the updated id. */
export const replacePortableRelationBundle: Bundle = makeBundle({
  exportedAt: MAY_30,
  entries: [
    entry('AuthorReplaceTest', 'olly', {
      entryTitle: 'Olly (replaced)',
      slug: 'olly',
      versions: [
        version(CONTENT_STATUSES.PUBLISHED, {
          data: { name: 'Olly (replaced)' },
          publishedAt: MAY_30,
        }),
      ],
    }),
    entry('ArticleReplaceTest', 'my-article', {
      entryTitle: 'My Article',
      slug: 'my-article',
      versions: [
        version(CONTENT_STATUSES.PUBLISHED, {
          data: {
            title: 'My Article',
            author: {
              contentTypeIdentifier: 'AuthorReplaceTest',
              entryKey: 'olly',
            },
          },
          publishedAt: MAY_30,
        }),
      ],
    }),
  ],
});

/** Non-portable entries-only bundle: a colliding PageDryRunTest entry plus a
 *  brand-new one — the dry-run reports 1 create + 1 update without writing. */
export const dryRunBundle: Bundle = makeBundle({
  exportedAt: MAY_30,
  portable: false,
  entries: [
    entry('PageDryRunTest', 'dry-run-target', {
      entryTitle: 'Conflicting',
      versions: [
        version(CONTENT_STATUSES.PUBLISHED, {
          data: { title: 'Conflicting' },
          publishedAt: MAY_30,
        }),
      ],
    }),
    entry('PageDryRunTest', 'dry-run-new', {
      entryTitle: 'Brand New',
      versions: [
        version(CONTENT_STATUSES.PUBLISHED, {
          data: { title: 'Brand New' },
          publishedAt: MAY_30,
        }),
      ],
    }),
  ],
});

// --- Non-portable dangling-reference guard fixtures (May 30 timestamp) ---
// These carry per-test `randomUUID()` content-type / field / entry ids, so
// they are FACTORY FUNCTIONS taking the ids as parameters.

/**
 * Non-portable bundle factory: a content type with an ENTRY_TITLE plus a
 * self-targeting RELATION field "rel", carrying the supplied entries. Field
 * ids are generated per call (matching the original's per-call randomUUID()).
 */
export function selfRelBundle(
  typeId: string,
  typeIdentifier: string,
  entries: Bundle['entries']
): Bundle {
  return makeBundle({
    exportedAt: MAY_30,
    portable: false,
    contentTypes: [
      ct(typeIdentifier, { id: typeId }, [
        field('title', FIELD_TYPES.ENTRY_TITLE, {
          id: randomUUID(),
          name: 'Title',
          required: true,
        }),
        field('rel', FIELD_TYPES.RELATION, {
          id: randomUUID(),
          name: 'Rel',
          order: 1,
          options: { targetContentTypeIds: [typeId] },
        }),
      ]),
    ],
    entries,
  });
}

/** selfRelBundle for DanglingRelType whose source entry's RELATION points at a
 *  missing entry id. */
export function danglingRelationBundle(
  typeId: string,
  entryId: string,
  missingId: string
): Bundle {
  return selfRelBundle(typeId, 'DanglingRelType', [
    entry('DanglingRelType', 'source', {
      id: entryId,
      contentTypeId: typeId,
      entryTitle: 'Source',
      slug: 'source',
      versions: [
        version(CONTENT_STATUSES.PUBLISHED, {
          publishedAt: MAY_30,
          data: {
            title: 'Source',
            rel: { contentTypeId: typeId, entryId: missingId },
          },
        }),
      ],
    }),
  ]);
}

/** selfRelBundle for ForwardRefType: entry A references entry B (declared
 *  later in the same bundle). */
export function forwardRefEntryBundle(
  typeId: string,
  idA: string,
  idB: string
): Bundle {
  return selfRelBundle(typeId, 'ForwardRefType', [
    entry('ForwardRefType', 'a', {
      id: idA,
      contentTypeId: typeId,
      entryTitle: 'A',
      slug: 'a',
      versions: [
        version(CONTENT_STATUSES.PUBLISHED, {
          publishedAt: MAY_30,
          data: { title: 'A', rel: { contentTypeId: typeId, entryId: idB } },
        }),
      ],
    }),
    entry('ForwardRefType', 'b', {
      id: idB,
      contentTypeId: typeId,
      entryTitle: 'B',
      slug: 'b',
      versions: [
        version(CONTENT_STATUSES.PUBLISHED, {
          publishedAt: MAY_30,
          data: { title: 'B' },
        }),
      ],
    }),
  ]);
}

/** selfRelBundle for PreExistingType seeding one Existing entry (no rel). */
export function preExistingSeedBundle(
  typeId: string,
  existingId: string
): Bundle {
  return selfRelBundle(typeId, 'PreExistingType', [
    entry('PreExistingType', 'existing', {
      id: existingId,
      contentTypeId: typeId,
      entryTitle: 'Existing',
      slug: 'existing',
      versions: [
        version(CONTENT_STATUSES.PUBLISHED, {
          publishedAt: MAY_30,
          data: { title: 'Existing' },
        }),
      ],
    }),
  ]);
}

/** Non-portable entries-only bundle (schema already present): a Referrer entry
 *  whose RELATION points at a pre-existing PreExistingType entry id. */
export function refToExistingBundle(
  typeId: string,
  referrerId: string,
  existingId: string
): Bundle {
  return makeBundle({
    exportedAt: MAY_30,
    portable: false,
    entries: [
      entry('PreExistingType', 'referrer', {
        id: referrerId,
        contentTypeId: typeId,
        entryTitle: 'Referrer',
        slug: 'referrer',
        versions: [
          version(CONTENT_STATUSES.PUBLISHED, {
            publishedAt: MAY_30,
            data: {
              title: 'Referrer',
              rel: { contentTypeId: typeId, entryId: existingId },
            },
          }),
        ],
      }),
    ],
  });
}

/** Non-portable bundle: a RichtextDangleType (ENTRY_TITLE + RICHTEXT body)
 *  whose body contains a cmsEmbed node pointing at a missing entry id. */
export function danglingRichtextBundle(
  typeId: string,
  entryId: string,
  missingId: string
): Bundle {
  return makeBundle({
    exportedAt: MAY_30,
    portable: false,
    contentTypes: [
      ct('RichtextDangleType', { id: typeId }, [
        field('title', FIELD_TYPES.ENTRY_TITLE, {
          id: randomUUID(),
          name: 'Title',
          required: true,
        }),
        field('body', FIELD_TYPES.RICHTEXT, {
          id: randomUUID(),
          name: 'Body',
          order: 1,
          options: { targetContentTypeIds: [typeId] },
        }),
      ]),
    ],
    entries: [
      entry('RichtextDangleType', 'source', {
        id: entryId,
        contentTypeId: typeId,
        entryTitle: 'Source',
        slug: 'source',
        versions: [
          version(CONTENT_STATUSES.PUBLISHED, {
            publishedAt: MAY_30,
            data: {
              title: 'Source',
              body: {
                type: 'doc',
                content: [
                  {
                    type: 'cmsEmbed',
                    attrs: { contentTypeId: typeId, entryId: missingId },
                  },
                ],
              },
            },
          }),
        ],
      }),
    ],
  });
}

/** Non-portable bundle: a DanglingMrelType (ENTRY_TITLE + MULTIRELATION)
 *  whose mrel array mixes a valid self-ref with a missing-id ref. */
export function danglingMultirelationBundle(
  typeId: string,
  entryId: string,
  missingId: string
): Bundle {
  return makeBundle({
    exportedAt: MAY_30,
    portable: false,
    contentTypes: [
      ct('DanglingMrelType', { id: typeId }, [
        field('title', FIELD_TYPES.ENTRY_TITLE, {
          id: randomUUID(),
          name: 'Title',
          required: true,
        }),
        field('mrel', FIELD_TYPES.MULTIRELATION, {
          id: randomUUID(),
          name: 'Mrel',
          order: 1,
          options: { targetContentTypeIds: [typeId] },
        }),
      ]),
    ],
    entries: [
      entry('DanglingMrelType', 'source', {
        id: entryId,
        contentTypeId: typeId,
        entryTitle: 'Source',
        slug: 'source',
        versions: [
          version(CONTENT_STATUSES.PUBLISHED, {
            publishedAt: MAY_30,
            data: {
              title: 'Source',
              mrel: [
                { contentTypeId: typeId, entryId: entryId },
                { contentTypeId: typeId, entryId: missingId },
              ],
            },
          }),
        ],
      }),
    ],
  });
}

/** Non-portable entries-only bundle (schema present): a Dup entry colliding on
 *  entryKey 'dup' with a seeded already-dangling row — used with skip. */
export function skipDangleCollidingBundle(
  typeId: string,
  entryId: string
): Bundle {
  return makeBundle({
    exportedAt: MAY_30,
    portable: false,
    entries: [
      entry('SkipDangleType', 'dup', {
        id: entryId,
        contentTypeId: typeId,
        entryTitle: 'Dup',
        slug: 'dup',
        versions: [
          version(CONTENT_STATUSES.PUBLISHED, {
            publishedAt: MAY_30,
            data: { title: 'Dup' },
          }),
        ],
      }),
    ],
  });
}
