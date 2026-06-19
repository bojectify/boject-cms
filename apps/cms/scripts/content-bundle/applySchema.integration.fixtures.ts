// Test-support fixtures for applySchema.integration.test.ts. NOT a test file
// (no *.test.ts glob match) and NOT vendored. The Bundle DATA flows through the
// shared builders in ./bundleFactories; DB seed rows (prisma.contentType.create
// arguments) and the deliberately-malformed bundle stay inline in the test —
// the former are not Bundles, the latter cannot be built by `ct` (it always
// emits a fields array, which is exactly the shape the malformed bundle omits).
import { ct, field, makeBundle } from './bundleFactories';
import type { Bundle } from './types';
import { FIELD_TYPES } from '../../utils/fieldTypes';

/** A single ENTRY_TITLE `title` field (required, order 0). */
const titleField = () =>
  field('title', FIELD_TYPES.ENTRY_TITLE, { name: 'Title', required: true });

/** Article with a title (ENTRY_TITLE) and a slug (SLUG) field. */
export const articleWithTitleAndSlug: Bundle = makeBundle({
  contentTypes: [
    ct('Article', { description: 'Blog article' }, [
      titleField(),
      field('slug', FIELD_TYPES.SLUG, { name: 'Slug', order: 1 }),
    ]),
  ],
});

/** Article with title only, renamed to "New Name" / "Renamed". */
export const articleRenamedWithTitle: Bundle = makeBundle({
  contentTypes: [
    ct('Article', { name: 'New Name', description: 'Renamed' }, [titleField()]),
  ],
});

/** Article with title + a new TEXT `tagline` field (pass-2 field create). */
export const articleWithTitleAndTagline: Bundle = makeBundle({
  contentTypes: [
    ct('Article', {}, [
      titleField(),
      field('tagline', FIELD_TYPES.TEXT, { name: 'Tagline', order: 1 }),
    ]),
  ],
});

/** Article carrying only its title field. */
export const articleTitleOnly: Bundle = makeBundle({
  contentTypes: [ct('Article', {}, [titleField()])],
});

/**
 * Article carrying a reserved field identifier (`status` collides with the
 * built-in entry envelope field) — rejected by applySchema's per-field check.
 */
export const articleWithReservedField: Bundle = makeBundle({
  contentTypes: [
    ct('Article', {}, [
      titleField(),
      field('status', FIELD_TYPES.SELECT, {
        name: 'Status',
        order: 1,
        options: { choices: ['x'] },
      }),
    ]),
  ],
});

/** Post whose SELECT `category` field gains an extra choice ('opinion'). */
export const postWithUpdatedSelect: Bundle = makeBundle({
  contentTypes: [
    ct('Post', {}, [
      titleField(),
      field('category', FIELD_TYPES.SELECT, {
        name: 'Category',
        order: 1,
        options: { choices: ['news', 'opinion'] },
      }),
    ]),
  ],
});

/** Article whose TEXT `tagline` field flips required false → true. */
export const articleWithRequiredTagline: Bundle = makeBundle({
  contentTypes: [
    ct('Article', {}, [
      titleField(),
      field('tagline', FIELD_TYPES.TEXT, {
        name: 'Tagline',
        required: true,
        order: 1,
      }),
    ]),
  ],
});

/**
 * Author (new) + Article with an `author` RELATION targeting Author, expressed
 * portably via `targetContentTypeIdentifiers`.
 */
export const authorAndArticleWithRelation: Bundle = makeBundle({
  contentTypes: [
    ct('Author', {}, [
      field('name', FIELD_TYPES.ENTRY_TITLE, { name: 'Name', required: true }),
    ]),
    ct('Article', {}, [
      titleField(),
      field('author', FIELD_TYPES.RELATION, {
        name: 'Author',
        order: 1,
        options: { targetContentTypeIdentifiers: ['Author'] },
      }),
    ]),
  ],
});

/**
 * Author + Article RELATION bundle as written by importBundle: the RELATION
 * options carry both the resolved-placeholder `targetContentTypeIds: [null]`
 * and the portable `targetContentTypeIdentifiers`.
 */
export const authorAndArticleWithResolvedRelation: Bundle = makeBundle({
  contentTypes: [
    ct('Author', {}, [
      field('name', FIELD_TYPES.ENTRY_TITLE, { name: 'Name', required: true }),
    ]),
    ct('Article', {}, [
      titleField(),
      field('author', FIELD_TYPES.RELATION, {
        name: 'Author',
        order: 1,
        options: {
          targetContentTypeIds: [null],
          targetContentTypeIdentifiers: ['Author'],
        },
      }),
    ]),
  ],
});

/**
 * Tag (new) + Article with a `tags` MULTIRELATION targeting Tag, with both the
 * resolved-placeholder ids and the portable identifiers.
 */
export const tagAndArticleWithMultirelation: Bundle = makeBundle({
  contentTypes: [
    ct('Tag', {}, [
      field('name', FIELD_TYPES.ENTRY_TITLE, { name: 'Name', required: true }),
    ]),
    ct('Article', {}, [
      titleField(),
      field('tags', FIELD_TYPES.MULTIRELATION, {
        name: 'Tags',
        order: 1,
        options: {
          targetContentTypeIds: [null],
          targetContentTypeIdentifiers: ['Tag'],
        },
      }),
    ]),
  ],
});

/** Article whose display name is "Renamed" (concurrency re-plan test). */
export const articleRenamedTitleOnly: Bundle = makeBundle({
  contentTypes: [ct('Article', { name: 'Renamed' }, [titleField()])],
});

/** A brand-new content type `NewType` with a title field. */
export const newTypeBundle: Bundle = makeBundle({
  contentTypes: [ct('NewType', {}, [titleField()])],
});

/** A brand-new content type `DryRunArticle` with a title field. */
export const dryRunArticleBundle: Bundle = makeBundle({
  contentTypes: [ct('DryRunArticle', {}, [titleField()])],
});

/** A brand-new content type `BlockedDryRun` with a title field. */
export const blockedDryRunBundle: Bundle = makeBundle({
  contentTypes: [ct('BlockedDryRun', {}, [titleField()])],
});

/**
 * Article with a title + a BOOLEAN `flag` field carrying `options.default:
 * false` and a NUMBER `qty` field carrying `options.default: 0` (#344). The
 * defaults ride inside `options`, so applySchema persists and diffs them like
 * any other options key — a re-apply must be a no-op.
 */
export const articleWithFieldDefaults: Bundle = makeBundle({
  contentTypes: [
    ct('Article', {}, [
      titleField(),
      field('flag', FIELD_TYPES.BOOLEAN, {
        name: 'Flag',
        order: 1,
        options: { default: false },
      }),
      field('qty', FIELD_TYPES.NUMBER, {
        name: 'Qty',
        order: 2,
        options: { default: 0 },
      }),
    ]),
  ],
});

/**
 * Article with a required BOOLEAN `flag` carrying NO default (#344) — illegal,
 * since "None" is not a legal value for a required field. applySchema must
 * reject this with BUNDLE_INVALID before opening a transaction, closing the
 * import-path gap where validateFieldDefault never ran.
 */
export const articleRequiredBooleanNoDefault: Bundle = makeBundle({
  contentTypes: [
    ct('Article', {}, [
      titleField(),
      field('flag', FIELD_TYPES.BOOLEAN, {
        name: 'Flag',
        order: 1,
        required: true,
      }),
    ]),
  ],
});
