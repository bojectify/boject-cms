// Test-support fixtures for planSchema.test.ts. NOT a test file (no *.test.ts
// glob match) and NOT vendored. Bundles are built via ./bundleFactories;
// snapshots via the `snapshot` builder plus the local snapType/snapField
// helpers below.
//
// CurrentSchemaSnapshot content-type fields are a DIFFERENT shape than
// BundleField — `id`/`unique` are required (no nulls), and the content type
// carries `entryCount`. The local snapType/snapField helpers produce that
// shape; do NOT reach for the bundle ct()/field() builders for snapshots.
//
// `fieldUsage` is a Map (with optionally-nested Maps for selectChoiceCounts /
// relationTargetCounts) — fixtures construct it directly. Parity with the
// original literals is proven per-fixture with a temporary toStrictEqual
// during extraction.
import type { FieldType } from '#prisma';
import type { Bundle, CurrentSchemaSnapshot } from './schemaPlan.types';
import { FIELD_TYPES } from '../../utils/fieldTypes';
import { ct, field, makeBundle, snapshot } from './bundleFactories';

type SnapType = CurrentSchemaSnapshot['contentTypes'][number];
type SnapField = SnapType['fields'][number];

/**
 * A snapshot content-type field. `unique` defaults to `false`, `options` to
 * `null`. Unlike the bundle `field()` builder, `id` and `unique` are part of
 * the required shape here.
 */
function snapField(
  id: string,
  identifier: string,
  type: FieldType,
  overrides: Partial<Omit<SnapField, 'id' | 'identifier' | 'type'>> = {}
): SnapField {
  return {
    id,
    identifier,
    name: identifier,
    type,
    required: false,
    unique: false,
    order: 0,
    options: null,
    ...overrides,
  };
}

/** A snapshot content-type. `entryCount` defaults to 0, `fields` to []. */
function snapType(
  id: string,
  identifier: string,
  overrides: Partial<Omit<SnapType, 'id' | 'identifier'>> = {}
): SnapType {
  return {
    id,
    identifier,
    name: identifier,
    description: null,
    fields: [],
    entryCount: 0,
    ...overrides,
  };
}

// --- Empty baselines (top-of-file consts) ---

export const emptySnapshot: CurrentSchemaSnapshot = snapshot();
export const emptyBundle: Bundle = makeBundle({ contentTypes: [] });

// --- type-level: create and update (rows 1, 4) ---

/** Bundle: a single Article content type with no fields. (row 1 create) */
export const articleCreateBundle: Bundle = makeBundle({
  contentTypes: [ct('Article')],
});

/** Bundle: Article whose name differs ('New Name'), description 'unchanged'. */
export const articleRenameBundle: Bundle = makeBundle({
  contentTypes: [ct('Article', { name: 'New Name', description: 'unchanged' })],
});

/** Snapshot: Article (id ct-1) with the old name + matching description. */
export const snapshotArticleOldName: CurrentSchemaSnapshot = snapshot({
  contentTypes: [
    snapType('ct-1', 'Article', {
      name: 'Old Name',
      description: 'unchanged',
    }),
  ],
});

/** Bundle: Article carrying a new description, same name. */
export const articleNewDescriptionBundle: Bundle = makeBundle({
  contentTypes: [ct('Article', { description: 'New description' })],
});

/** Snapshot: Article (id ct-1), name matches, description null. */
export const snapshotArticleNullDescription: CurrentSchemaSnapshot = snapshot({
  contentTypes: [snapType('ct-1', 'Article')],
});

/** Bundle: Article matching the snapshot exactly (no-op update). */
export const articleUnchangedBundle: Bundle = makeBundle({
  contentTypes: [ct('Article')],
});

/** Snapshot: Article (id ct-1) matching articleUnchangedBundle exactly. */
export const snapshotArticleUnchanged: CurrentSchemaSnapshot = snapshot({
  contentTypes: [snapType('ct-1', 'Article')],
});

// --- type-level: removal (rows 2, 3) ---

/** Snapshot: an empty OrphanType (id ct-1, name 'Orphan', 0 entries). */
export const snapshotOrphanType: CurrentSchemaSnapshot = snapshot({
  contentTypes: [snapType('ct-1', 'OrphanType', { name: 'Orphan' })],
});

/** Snapshot: a PopulatedType (id ct-2, name 'Populated') with 17 entries. */
export const snapshotPopulatedType: CurrentSchemaSnapshot = snapshot({
  contentTypes: [
    snapType('ct-2', 'PopulatedType', { name: 'Populated', entryCount: 17 }),
  ],
});

// --- field-level: create on existing type (row 6) ---

/** Bundle: Article with title (ENTRY_TITLE) + a new tagline (TEXT, order 1). */
export const articleWithTaglineBundle: Bundle = makeBundle({
  contentTypes: [
    ct('Article', {}, [
      field('title', FIELD_TYPES.ENTRY_TITLE, {
        name: 'Title',
        required: true,
      }),
      field('tagline', FIELD_TYPES.TEXT, { name: 'Tagline', order: 1 }),
    ]),
  ],
});

/** Snapshot: Article (id ct-1) with only the title field, 0 entries. */
export const snapshotArticleTitleOnly: CurrentSchemaSnapshot = snapshot({
  contentTypes: [
    snapType('ct-1', 'Article', {
      fields: [
        snapField('f-1', 'title', FIELD_TYPES.ENTRY_TITLE, {
          name: 'Title',
          required: true,
          unique: true,
        }),
      ],
    }),
  ],
});

/** Non-portable bundle: Article (id ct-1) renaming tagline → renamedTagline
 *  (field id f-2 preserved). title is field id f-1. */
export const articleFieldRenameBundle: Bundle = makeBundle({
  portable: false,
  contentTypes: [
    ct('Article', { id: 'ct-1' }, [
      field('title', FIELD_TYPES.ENTRY_TITLE, {
        id: 'f-1',
        name: 'Title',
        required: true,
      }),
      field('renamedTagline', FIELD_TYPES.TEXT, {
        id: 'f-2',
        name: 'Tagline',
        order: 1,
      }),
    ]),
  ],
});

/** Snapshot: Article (id ct-1) with title (f-1) + tagline (f-2), 0 entries. */
export const snapshotArticleTitleTagline: CurrentSchemaSnapshot = snapshot({
  contentTypes: [
    snapType('ct-1', 'Article', {
      fields: [
        snapField('f-1', 'title', FIELD_TYPES.ENTRY_TITLE, {
          name: 'Title',
          required: true,
          unique: true,
        }),
        snapField('f-2', 'tagline', FIELD_TYPES.TEXT, {
          name: 'Tagline',
          order: 1,
        }),
      ],
    }),
  ],
});

/** Bundle: Article with title + a new required category (TEXT, order 1). */
export const articleNewRequiredCategoryBundle: Bundle = makeBundle({
  contentTypes: [
    ct('Article', {}, [
      field('title', FIELD_TYPES.ENTRY_TITLE, {
        name: 'Title',
        required: true,
      }),
      field('category', FIELD_TYPES.TEXT, {
        name: 'Category',
        required: true,
        order: 1,
      }),
    ]),
  ],
});

/** Snapshot: Article (id ct-1) with only the title field, 5 entries. */
export const snapshotArticleTitleOnlyFiveEntries: CurrentSchemaSnapshot =
  snapshot({
    contentTypes: [
      snapType('ct-1', 'Article', {
        entryCount: 5,
        fields: [
          snapField('f-1', 'title', FIELD_TYPES.ENTRY_TITLE, {
            name: 'Title',
            required: true,
            unique: true,
          }),
        ],
      }),
    ],
  });

// --- field-level: name and order updates (row 9) ---
// (the snapshot for both row-9 tests is snapshotArticleTitleOnly above.)

/** Bundle: Article with title field renamed to 'Renamed Title'. */
export const articleTitleRenamedBundle: Bundle = makeBundle({
  contentTypes: [
    ct('Article', {}, [
      field('title', FIELD_TYPES.ENTRY_TITLE, {
        name: 'Renamed Title',
        required: true,
      }),
    ]),
  ],
});

/** Bundle: Article with title field bumped to order 5. */
export const articleTitleReorderedBundle: Bundle = makeBundle({
  contentTypes: [
    ct('Article', {}, [
      field('title', FIELD_TYPES.ENTRY_TITLE, {
        name: 'Title',
        required: true,
        order: 5,
      }),
    ]),
  ],
});

// --- field-level: required transitions (rows 10, 11, 12) ---

/** Bundle: Article with a required tagline (TEXT). Shared by rows 10 & 11. */
export const articleRequiredTaglineBundle: Bundle = makeBundle({
  contentTypes: [
    ct('Article', {}, [
      field('tagline', FIELD_TYPES.TEXT, { name: 'Tagline', required: true }),
    ]),
  ],
});

/** Snapshot: Article (ct-1) with an optional tagline, 3 entries, all valued. */
export const snapshotArticleOptionalTaglineAllValued: CurrentSchemaSnapshot =
  snapshot({
    contentTypes: [
      snapType('ct-1', 'Article', {
        entryCount: 3,
        fields: [
          snapField('f-1', 'tagline', FIELD_TYPES.TEXT, { name: 'Tagline' }),
        ],
      }),
    ],
    fieldUsage: new Map([['Article:tagline', { entriesWithValue: 3 }]]),
  });

/** Snapshot: Article (ct-1) with an optional tagline, 5 entries, 3 valued
 *  (so 2 hold null — the optional→required blocker fires). */
export const snapshotArticleOptionalTaglineSomeNull: CurrentSchemaSnapshot =
  snapshot({
    contentTypes: [
      snapType('ct-1', 'Article', {
        entryCount: 5,
        fields: [
          snapField('f-1', 'tagline', FIELD_TYPES.TEXT, { name: 'Tagline' }),
        ],
      }),
    ],
    fieldUsage: new Map([['Article:tagline', { entriesWithValue: 3 }]]),
  });

/** Bundle: Article with an optional tagline (required → optional, row 12). */
export const articleOptionalTaglineBundle: Bundle = makeBundle({
  contentTypes: [
    ct('Article', {}, [
      field('tagline', FIELD_TYPES.TEXT, { name: 'Tagline' }),
    ]),
  ],
});

/** Snapshot: Article (ct-1) with a required tagline, 99 entries. */
export const snapshotArticleRequiredTagline: CurrentSchemaSnapshot = snapshot({
  contentTypes: [
    snapType('ct-1', 'Article', {
      entryCount: 99,
      fields: [
        snapField('f-1', 'tagline', FIELD_TYPES.TEXT, {
          name: 'Tagline',
          required: true,
        }),
      ],
    }),
  ],
});

// --- field-level: unique transitions (rows 13, 14, 15) ---

/** Bundle: Product with a unique sku (TEXT). Shared by rows 13 & 14. */
export const productUniqueSkuBundle: Bundle = makeBundle({
  contentTypes: [
    ct('Product', {}, [
      field('sku', FIELD_TYPES.TEXT, { name: 'SKU', unique: true }),
    ]),
  ],
});

/** Snapshot: Product (ct-1) with a non-unique sku, 3 entries, no duplicates. */
export const snapshotProductSkuNoDuplicates: CurrentSchemaSnapshot = snapshot({
  contentTypes: [
    snapType('ct-1', 'Product', {
      entryCount: 3,
      fields: [snapField('f-1', 'sku', FIELD_TYPES.TEXT, { name: 'SKU' })],
    }),
  ],
  fieldUsage: new Map([
    ['Product:sku', { entriesWithValue: 3, duplicateValues: [] }],
  ]),
});

/** Snapshot: Product (ct-1) with a non-unique sku, 4 entries, two duplicate
 *  values (ABC over e1/e2, DEF over e3/e4) — the unique-conflict blocker. */
export const snapshotProductSkuDuplicates: CurrentSchemaSnapshot = snapshot({
  contentTypes: [
    snapType('ct-1', 'Product', {
      entryCount: 4,
      fields: [snapField('f-1', 'sku', FIELD_TYPES.TEXT, { name: 'SKU' })],
    }),
  ],
  fieldUsage: new Map([
    [
      'Product:sku',
      {
        entriesWithValue: 4,
        duplicateValues: [
          { value: 'ABC', entryIds: ['e1', 'e2'] },
          { value: 'DEF', entryIds: ['e3', 'e4'] },
        ],
      },
    ],
  ]),
});

/** Bundle: Product with a non-unique sku (unique true → false, row 15).
 *  The original literal carries an explicit `unique: false` (not absent), so
 *  pass it through — toStrictEqual distinguishes the two. */
export const productNonUniqueSkuBundle: Bundle = makeBundle({
  contentTypes: [
    ct('Product', {}, [
      field('sku', FIELD_TYPES.TEXT, { name: 'SKU', unique: false }),
    ]),
  ],
});

/** Snapshot: Product (ct-1) with a unique sku, 99 entries. */
export const snapshotProductUniqueSku: CurrentSchemaSnapshot = snapshot({
  contentTypes: [
    snapType('ct-1', 'Product', {
      entryCount: 99,
      fields: [
        snapField('f-1', 'sku', FIELD_TYPES.TEXT, {
          name: 'SKU',
          unique: true,
        }),
      ],
    }),
  ],
});

// --- field-level: SELECT choice changes (rows 17, 18, 19) ---

/** Bundle: Post with a SELECT category whose choices are news/opinion/review. */
export const postCategoryThreeChoicesBundle: Bundle = makeBundle({
  contentTypes: [
    ct('Post', {}, [
      field('category', FIELD_TYPES.SELECT, {
        name: 'Category',
        options: { choices: ['news', 'opinion', 'review'] },
      }),
    ]),
  ],
});

/** Snapshot: Post (ct-1) SELECT category with news/opinion, 0 entries. */
export const snapshotPostCategoryTwoChoices: CurrentSchemaSnapshot = snapshot({
  contentTypes: [
    snapType('ct-1', 'Post', {
      fields: [
        snapField('f-1', 'category', FIELD_TYPES.SELECT, {
          name: 'Category',
          options: { choices: ['news', 'opinion'] },
        }),
      ],
    }),
  ],
});

/** Bundle: Post SELECT category whose only remaining choice is 'news'.
 *  Shared by rows 18 (unused-removal) & 19 (in-use removal). */
export const postCategoryNewsOnlyBundle: Bundle = makeBundle({
  contentTypes: [
    ct('Post', {}, [
      field('category', FIELD_TYPES.SELECT, {
        name: 'Category',
        options: { choices: ['news'] },
      }),
    ]),
  ],
});

/** Snapshot: Post (ct-1) SELECT category news/opinion, 5 entries, all 'news'
 *  (so dropping 'opinion' is safe — row 18). */
export const snapshotPostCategoryOpinionUnused: CurrentSchemaSnapshot =
  snapshot({
    contentTypes: [
      snapType('ct-1', 'Post', {
        entryCount: 5,
        fields: [
          snapField('f-1', 'category', FIELD_TYPES.SELECT, {
            name: 'Category',
            options: { choices: ['news', 'opinion'] },
          }),
        ],
      }),
    ],
    fieldUsage: new Map([
      [
        'Post:category',
        { entriesWithValue: 5, selectChoiceCounts: new Map([['news', 5]]) },
      ],
    ]),
  });

/** Snapshot: Post (ct-1) SELECT category news/opinion, 6 entries, opinion in
 *  use by 2 (so dropping it is blocked — row 19). */
export const snapshotPostCategoryOpinionInUse: CurrentSchemaSnapshot = snapshot(
  {
    contentTypes: [
      snapType('ct-1', 'Post', {
        entryCount: 6,
        fields: [
          snapField('f-1', 'category', FIELD_TYPES.SELECT, {
            name: 'Category',
            options: { choices: ['news', 'opinion'] },
          }),
        ],
      }),
    ],
    fieldUsage: new Map([
      [
        'Post:category',
        {
          entriesWithValue: 6,
          selectChoiceCounts: new Map([
            ['news', 4],
            ['opinion', 2],
          ]),
        },
      ],
    ]),
  }
);

// --- field-level: RELATION target changes (rows 20, 21, 22) ---

/** Bundle: Article.author RELATION targeting Author + Editor, with both
 *  target types present so the cross-ref pass resolves (row 20 add). */
export const articleRelationTwoTargetsBundle: Bundle = makeBundle({
  contentTypes: [
    ct('Article', {}, [
      field('author', FIELD_TYPES.RELATION, {
        name: 'Author',
        options: { targetContentTypeIdentifiers: ['Author', 'Editor'] },
      }),
    ]),
    ct('Author'),
    ct('Editor'),
  ],
});

/** Snapshot: Article (ct-1) author RELATION targeting Author only, plus the
 *  Author + Editor types, 0 entries everywhere. */
export const snapshotArticleRelationOneTarget: CurrentSchemaSnapshot = snapshot(
  {
    contentTypes: [
      snapType('ct-1', 'Article', {
        fields: [
          snapField('f-1', 'author', FIELD_TYPES.RELATION, {
            name: 'Author',
            options: { targetContentTypeIdentifiers: ['Author'] },
          }),
        ],
      }),
      snapType('ct-author', 'Author'),
      snapType('ct-editor', 'Editor'),
    ],
  }
);

/** Bundle: Article.author RELATION targeting Author only, plus the Author
 *  type (row 21 unused-target removal). */
export const articleRelationOneTargetBundle: Bundle = makeBundle({
  contentTypes: [
    ct('Article', {}, [
      field('author', FIELD_TYPES.RELATION, {
        name: 'Author',
        options: { targetContentTypeIdentifiers: ['Author'] },
      }),
    ]),
    ct('Author'),
  ],
});

/** Snapshot: Article (ct-1) author RELATION targeting Author + Editor, 4
 *  entries, all on Author (so dropping Editor is safe — row 21). Author type
 *  present; Editor absent from the snapshot. */
export const snapshotArticleRelationEditorUnused: CurrentSchemaSnapshot =
  snapshot({
    contentTypes: [
      snapType('ct-1', 'Article', {
        entryCount: 4,
        fields: [
          snapField('f-1', 'author', FIELD_TYPES.RELATION, {
            name: 'Author',
            options: { targetContentTypeIdentifiers: ['Author', 'Editor'] },
          }),
        ],
      }),
      snapType('ct-author', 'Author'),
    ],
    fieldUsage: new Map([
      [
        'Article:author',
        { entriesWithValue: 4, relationTargetCounts: new Map([['Author', 4]]) },
      ],
    ]),
  });

/** Bundle: Article.author RELATION targeting Author only, plus BOTH Author
 *  and Editor types (so the cross-ref pass resolves Editor even though the
 *  field drops it) — row 22 in-use-target removal. */
export const articleRelationOneTargetBothTypesBundle: Bundle = makeBundle({
  contentTypes: [
    ct('Article', {}, [
      field('author', FIELD_TYPES.RELATION, {
        name: 'Author',
        options: { targetContentTypeIdentifiers: ['Author'] },
      }),
    ]),
    ct('Author'),
    ct('Editor'),
  ],
});

/** Snapshot: Article (ct-1) author RELATION targeting Author + Editor, 6
 *  entries, Editor in use by 2 (so dropping Editor is blocked — row 22).
 *  Author + Editor types present. */
export const snapshotArticleRelationEditorInUse: CurrentSchemaSnapshot =
  snapshot({
    contentTypes: [
      snapType('ct-1', 'Article', {
        entryCount: 6,
        fields: [
          snapField('f-1', 'author', FIELD_TYPES.RELATION, {
            name: 'Author',
            options: { targetContentTypeIdentifiers: ['Author', 'Editor'] },
          }),
        ],
      }),
      snapType('ct-author', 'Author'),
      snapType('ct-editor', 'Editor'),
    ],
    fieldUsage: new Map([
      [
        'Article:author',
        {
          entriesWithValue: 6,
          relationTargetCounts: new Map([
            ['Author', 4],
            ['Editor', 2],
          ]),
        },
      ],
    ]),
  });

// --- field-level: RICHTEXT and unrecognised options (rows 23, 24) ---

/** Bundle: Article.body RICHTEXT with a non-empty embed allow-list (row 23). */
export const articleRichtextAllowlistBundle: Bundle = makeBundle({
  contentTypes: [
    ct('Article', {}, [
      field('body', FIELD_TYPES.RICHTEXT, {
        name: 'Body',
        options: { targetContentTypeIds: ['ct-img'] },
      }),
    ]),
  ],
});

/** Snapshot: Article (ct-1) body RICHTEXT with an empty allow-list, 99 entries. */
export const snapshotArticleRichtextEmptyAllowlist: CurrentSchemaSnapshot =
  snapshot({
    contentTypes: [
      snapType('ct-1', 'Article', {
        entryCount: 99,
        fields: [
          snapField('f-1', 'body', FIELD_TYPES.RICHTEXT, {
            name: 'Body',
            options: { targetContentTypeIds: [] },
          }),
        ],
      }),
    ],
  });

/** Bundle: Article.tagline TEXT carrying an unrecognised option key (row 24). */
export const articleUnknownOptionBundle: Bundle = makeBundle({
  contentTypes: [
    ct('Article', {}, [
      field('tagline', FIELD_TYPES.TEXT, {
        name: 'Tagline',
        options: { newFutureOption: true },
      }),
    ]),
  ],
});

/** Snapshot: Article (ct-1) tagline TEXT with null options, 0 entries. */
export const snapshotArticleTaglineNoOptions: CurrentSchemaSnapshot = snapshot({
  contentTypes: [
    snapType('ct-1', 'Article', {
      fields: [
        snapField('f-1', 'tagline', FIELD_TYPES.TEXT, { name: 'Tagline' }),
      ],
    }),
  ],
});

// --- field-level: type change blocker (row 16) ---

/** Bundle: Article.count as NUMBER (snapshot has it as TEXT — type change). */
export const articleCountNumberBundle: Bundle = makeBundle({
  contentTypes: [
    ct('Article', {}, [field('count', FIELD_TYPES.NUMBER, { name: 'Count' })]),
  ],
});

/** Snapshot: Article (ct-1) count as TEXT, 0 entries. */
export const snapshotArticleCountText: CurrentSchemaSnapshot = snapshot({
  contentTypes: [
    snapType('ct-1', 'Article', {
      fields: [snapField('f-1', 'count', FIELD_TYPES.TEXT, { name: 'Count' })],
    }),
  ],
});

// --- type-level: identifier change blocker (row 5) ---
// (the snapshot for all three row-5 tests is snapshotArticleUnchanged above.)

/** Non-portable bundle: id ct-1 but identifier RenamedArticle (name
 *  'Renamed Article') — an attempted identifier change on the same row. */
export const articleIdentifierChangeBundle: Bundle = makeBundle({
  portable: false,
  contentTypes: [ct('RenamedArticle', { id: 'ct-1', name: 'Renamed Article' })],
});

/** Non-portable bundle: id ct-1, identifier RenamedArticle, name 'Renamed'
 *  (the allowDestructive variant — still blocked). */
export const articleIdentifierChangeShortNameBundle: Bundle = makeBundle({
  portable: false,
  contentTypes: [ct('RenamedArticle', { id: 'ct-1', name: 'Renamed' })],
});

/** Portable bundle: id null, identifier RenamedArticle, name 'Renamed' — a
 *  rename indistinguishable from remove+create (no detection signal). */
export const articleRenamePortableBundle: Bundle = makeBundle({
  contentTypes: [ct('RenamedArticle', { name: 'Renamed' })],
});

// --- cross-references ---

/** Bundle: an Author type plus an Article whose author RELATION targets
 *  Author — both in the bundle, so the cross-ref pass resolves. */
export const crossRefBundleAuthorInBundle: Bundle = makeBundle({
  contentTypes: [
    ct('Author'),
    ct('Article', {}, [
      field('author', FIELD_TYPES.RELATION, {
        name: 'Author',
        options: { targetContentTypeIdentifiers: ['Author'] },
      }),
    ]),
  ],
});

/** Bundle: an Article whose author RELATION targets Author (Author lives only
 *  in the DB snapshot, not the bundle). */
export const crossRefBundleAuthorInDb: Bundle = makeBundle({
  contentTypes: [
    ct('Article', {}, [
      field('author', FIELD_TYPES.RELATION, {
        name: 'Author',
        options: { targetContentTypeIdentifiers: ['Author'] },
      }),
    ]),
  ],
});

/** Snapshot: an Author type (id ct-author, 0 entries). */
export const snapshotAuthorOnly: CurrentSchemaSnapshot = snapshot({
  contentTypes: [snapType('ct-author', 'Author')],
});

/** Bundle: an Article whose author RELATION targets a type present in neither
 *  the bundle nor the DB. */
export const crossRefBundleMissingTarget: Bundle = makeBundle({
  contentTypes: [
    ct('Article', {}, [
      field('author', FIELD_TYPES.RELATION, {
        name: 'Author',
        options: { targetContentTypeIdentifiers: ['MissingType'] },
      }),
    ]),
  ],
});

// --- plan ordering ---

/** Bundle: a brand-new Author type (with a name ENTRY_TITLE) + an Article
 *  type that already exists on the target with the same title field. */
export const planOrderingBundle: Bundle = makeBundle({
  contentTypes: [
    ct('Author', {}, [
      field('name', FIELD_TYPES.ENTRY_TITLE, {
        name: 'Name',
        required: true,
      }),
    ]),
    ct('Article', {}, [
      field('title', FIELD_TYPES.ENTRY_TITLE, {
        name: 'Title',
        required: true,
      }),
    ]),
  ],
});

/** Snapshot: only Article (id ct-article) with its title field, 0 entries. */
export const snapshotArticleTitleOnlyForOrdering: CurrentSchemaSnapshot =
  snapshot({
    contentTypes: [
      snapType('ct-article', 'Article', {
        fields: [
          snapField('f-1', 'title', FIELD_TYPES.ENTRY_TITLE, {
            name: 'Title',
            required: true,
            unique: true,
          }),
        ],
      }),
    ],
  });

// --- field-level: removal (rows 7, 8) ---

/** Bundle: Article with only the title field (drops oldField). Shared by all
 *  three removal tests (rows 7 block, row 7 unlock, row 8 warn). */
export const articleTitleOnlyDropsFieldBundle: Bundle = makeBundle({
  contentTypes: [
    ct('Article', {}, [
      field('title', FIELD_TYPES.ENTRY_TITLE, {
        name: 'Title',
        required: true,
      }),
    ]),
  ],
});

/** Snapshot: Article (ct-1) with title + oldField (TEXT, order 1), 0 entries.
 *  Shared by the two row-7 removal tests. */
export const snapshotArticleWithOldField: CurrentSchemaSnapshot = snapshot({
  contentTypes: [
    snapType('ct-1', 'Article', {
      fields: [
        snapField('f-1', 'title', FIELD_TYPES.ENTRY_TITLE, {
          name: 'Title',
          required: true,
          unique: true,
        }),
        snapField('f-2', 'oldField', FIELD_TYPES.TEXT, {
          name: 'Old Field',
          order: 1,
        }),
      ],
    }),
  ],
});

/** Snapshot: Article (ct-1) with title + oldField, 7 entries, oldField valued
 *  on 5 (row 8 data-loss warning). */
export const snapshotArticleWithOldFieldValued: CurrentSchemaSnapshot =
  snapshot({
    contentTypes: [
      snapType('ct-1', 'Article', {
        entryCount: 7,
        fields: [
          snapField('f-1', 'title', FIELD_TYPES.ENTRY_TITLE, {
            name: 'Title',
            required: true,
            unique: true,
          }),
          snapField('f-2', 'oldField', FIELD_TYPES.TEXT, {
            name: 'Old Field',
            order: 1,
          }),
        ],
      }),
    ],
    fieldUsage: new Map([['Article:oldField', { entriesWithValue: 5 }]]),
  });

// --- options equality edge cases ---

/** Bundle: Article with title (null options) + tagline whose options is `{}`
 *  (empty object, not null) — should be treated as equivalent to null. */
export const articleEmptyOptionsBundle: Bundle = makeBundle({
  contentTypes: [
    ct('Article', {}, [
      field('title', FIELD_TYPES.ENTRY_TITLE, {
        name: 'Title',
        required: true,
      }),
      field('tagline', FIELD_TYPES.TEXT, {
        name: 'Tagline',
        order: 1,
        options: {},
      }),
    ]),
  ],
});

/** Snapshot: Article (ct-1) with title + tagline, both null options, 0
 *  entries (pairs with articleEmptyOptionsBundle for the {}-vs-null case). */
export const snapshotArticleNullOptions: CurrentSchemaSnapshot = snapshot({
  contentTypes: [
    snapType('ct-1', 'Article', {
      fields: [
        snapField('f-1', 'title', FIELD_TYPES.ENTRY_TITLE, {
          name: 'Title',
          required: true,
          unique: true,
        }),
        snapField('f-2', 'tagline', FIELD_TYPES.TEXT, {
          name: 'Tagline',
          order: 1,
        }),
      ],
    }),
  ],
});

/** Bundle: Article with title + tagline, both null options (the symmetric
 *  case where the snapshot tagline carries `{}` instead). */
export const articleNullOptionsBundle: Bundle = makeBundle({
  contentTypes: [
    ct('Article', {}, [
      field('title', FIELD_TYPES.ENTRY_TITLE, {
        name: 'Title',
        required: true,
      }),
      field('tagline', FIELD_TYPES.TEXT, { name: 'Tagline', order: 1 }),
    ]),
  ],
});

/** Snapshot: Article (ct-1) with title (null options) + tagline whose options
 *  is `{}`, 0 entries (symmetric to snapshotArticleNullOptions). */
export const snapshotArticleEmptyOptions: CurrentSchemaSnapshot = snapshot({
  contentTypes: [
    snapType('ct-1', 'Article', {
      fields: [
        snapField('f-1', 'title', FIELD_TYPES.ENTRY_TITLE, {
          name: 'Title',
          required: true,
          unique: true,
        }),
        snapField('f-2', 'tagline', FIELD_TYPES.TEXT, {
          name: 'Tagline',
          order: 1,
          options: {},
        }),
      ],
    }),
  ],
});
