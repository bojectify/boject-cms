import { describe, expect, it } from 'vitest';
import { planSchema } from './planSchema';
import * as fx from './planSchema.fixtures';

const emptySnapshot = fx.emptySnapshot;
const emptyBundle = fx.emptyBundle;

describe('planSchema', () => {
  describe('empty inputs', () => {
    it('returns an empty plan for an empty bundle and snapshot', () => {
      const plan = planSchema(emptyBundle, emptySnapshot);
      expect(plan.contentTypes.create).toEqual([]);
      expect(plan.contentTypes.update).toEqual([]);
      expect(plan.contentTypes.remove).toEqual([]);
      expect(plan.fields.create).toEqual([]);
      expect(plan.fields.update).toEqual([]);
      expect(plan.fields.remove).toEqual([]);
      expect(plan.warnings).toEqual([]);
      expect(plan.blockers).toEqual([]);
    });
  });

  describe('type-level: create and update (rows 1, 4)', () => {
    it('plans a create for a content type in the bundle but not in the snapshot (row 1)', () => {
      const plan = planSchema(fx.articleCreateBundle, emptySnapshot);
      expect(plan.contentTypes.create).toHaveLength(1);
      expect(plan.contentTypes.create[0]!.identifier).toBe('Article');
      expect(plan.contentTypes.update).toEqual([]);
    });

    it('plans a name update when the name differs (row 4)', () => {
      const plan = planSchema(
        fx.articleRenameBundle,
        fx.snapshotArticleOldName
      );
      expect(plan.contentTypes.update).toEqual([
        { id: 'ct-1', identifier: 'Article', changes: { name: 'New Name' } },
      ]);
      expect(plan.contentTypes.create).toEqual([]);
    });

    it('plans a description-only update (row 4)', () => {
      const plan = planSchema(
        fx.articleNewDescriptionBundle,
        fx.snapshotArticleNullDescription
      );
      expect(plan.contentTypes.update).toEqual([
        {
          id: 'ct-1',
          identifier: 'Article',
          changes: { description: 'New description' },
        },
      ]);
    });

    it('does not plan an update when the type matches exactly', () => {
      const plan = planSchema(
        fx.articleUnchangedBundle,
        fx.snapshotArticleUnchanged
      );
      expect(plan.contentTypes.create).toEqual([]);
      expect(plan.contentTypes.update).toEqual([]);
    });
  });

  describe('type-level: removal (rows 2, 3)', () => {
    it('blocks removal of an empty content type without allowDestructive (row 2)', () => {
      const plan = planSchema(fx.emptyBundle, fx.snapshotOrphanType);
      expect(plan.blockers).toHaveLength(1);
      expect(plan.blockers[0]!.code).toBe('CONTENT_TYPE_REMOVAL_NEEDS_FLAG');
      expect(plan.blockers[0]!.path).toBe('contentTypes.OrphanType');
      expect(plan.contentTypes.remove).toEqual([]);
    });

    it('unlocks removal of an empty content type with allowDestructive (row 2)', () => {
      const plan = planSchema(fx.emptyBundle, fx.snapshotOrphanType, {
        allowDestructive: true,
      });
      expect(plan.blockers).toEqual([]);
      expect(plan.contentTypes.remove).toEqual([
        { id: 'ct-1', identifier: 'OrphanType', entryCount: 0 },
      ]);
    });

    it('blocks removal of a content type with entries even with allowDestructive (row 3)', () => {
      const plan = planSchema(fx.emptyBundle, fx.snapshotPopulatedType, {
        allowDestructive: true,
      });
      expect(plan.blockers).toHaveLength(1);
      expect(plan.blockers[0]!.code).toBe('CONTENT_TYPE_REMOVAL_WITH_ENTRIES');
      expect(plan.blockers[0]!.path).toBe('contentTypes.PopulatedType');
      expect(plan.contentTypes.remove).toEqual([]);
    });
  });

  describe('field-level: create on existing type (row 6)', () => {
    it('plans a field create on an existing type when no entries exist (safe)', () => {
      const plan = planSchema(
        fx.articleWithTaglineBundle,
        fx.snapshotArticleTitleOnly
      );
      expect(plan.fields.create).toHaveLength(1);
      expect(plan.fields.create[0]!.contentTypeIdentifier).toBe('Article');
      expect(plan.fields.create[0]!.field.identifier).toBe('tagline');
      expect(plan.warnings).toEqual([]);
    });

    it('blocks a field-identifier change attempted via a non-portable bundle', () => {
      const plan = planSchema(
        fx.articleFieldRenameBundle,
        fx.snapshotArticleTitleTagline
      );
      expect(plan.blockers).toHaveLength(1);
      expect(plan.blockers[0]!.code).toBe('FIELD_IDENTIFIER_CHANGE');
      expect(plan.blockers[0]!.path).toBe('fields.Article.renamedTagline');
      expect(plan.blockers[0]!.message).toContain('tagline');
      expect(plan.blockers[0]!.message).toContain('renamedTagline');
      // Suppress noise: no spurious create or removal blocker for the
      // pretend-renamed field.
      expect(plan.fields.create).toEqual([]);
      expect(plan.fields.remove).toEqual([]);
    });

    it('warns on a new required field when entries exist (row 6 warning path)', () => {
      const plan = planSchema(
        fx.articleNewRequiredCategoryBundle,
        fx.snapshotArticleTitleOnlyFiveEntries
      );
      expect(plan.fields.create).toHaveLength(1);
      expect(plan.warnings).toHaveLength(1);
      expect(plan.warnings[0]!.code).toBe('NEW_REQUIRED_FIELD_WITH_ENTRIES');
      expect(plan.warnings[0]!.path).toBe('fields.Article.category');
    });
  });

  describe('field-level: name and order updates (row 9)', () => {
    it('plans a name update', () => {
      const plan = planSchema(
        fx.articleTitleRenamedBundle,
        fx.snapshotArticleTitleOnly
      );
      expect(plan.fields.update).toEqual([
        {
          id: 'f-1',
          contentTypeIdentifier: 'Article',
          fieldIdentifier: 'title',
          changes: { name: 'Renamed Title' },
        },
      ]);
    });

    it('plans an order-only update', () => {
      const plan = planSchema(
        fx.articleTitleReorderedBundle,
        fx.snapshotArticleTitleOnly
      );
      expect(plan.fields.update).toEqual([
        {
          id: 'f-1',
          contentTypeIdentifier: 'Article',
          fieldIdentifier: 'title',
          changes: { order: 5 },
        },
      ]);
    });
  });

  describe('field-level: required transitions (rows 10, 11, 12)', () => {
    it('plans optional → required when no entries have null (row 10)', () => {
      const plan = planSchema(
        fx.articleRequiredTaglineBundle,
        fx.snapshotArticleOptionalTaglineAllValued
      );
      expect(plan.fields.update).toEqual([
        {
          id: 'f-1',
          contentTypeIdentifier: 'Article',
          fieldIdentifier: 'tagline',
          changes: { required: true },
        },
      ]);
      expect(plan.blockers).toEqual([]);
    });

    it('blocks optional → required when entries have null (row 11)', () => {
      const plan = planSchema(
        fx.articleRequiredTaglineBundle,
        fx.snapshotArticleOptionalTaglineSomeNull
      );
      expect(plan.fields.update).toEqual([]);
      expect(plan.blockers).toHaveLength(1);
      expect(plan.blockers[0]!.code).toBe('OPTIONAL_TO_REQUIRED_HAS_NULLS');
      expect(plan.blockers[0]!.path).toBe('fields.Article.tagline');
      expect(plan.blockers[0]!.message).toContain('2'); // 5 - 3 = 2 missing
    });

    it('plans required → optional always (row 12)', () => {
      const plan = planSchema(
        fx.articleOptionalTaglineBundle,
        fx.snapshotArticleRequiredTagline
      );
      expect(plan.fields.update).toEqual([
        {
          id: 'f-1',
          contentTypeIdentifier: 'Article',
          fieldIdentifier: 'tagline',
          changes: { required: false },
        },
      ]);
    });
  });

  describe('field-level: unique transitions (rows 13, 14, 15)', () => {
    it('plans unique false → true when no duplicates exist (row 13)', () => {
      const plan = planSchema(
        fx.productUniqueSkuBundle,
        fx.snapshotProductSkuNoDuplicates
      );
      expect(plan.fields.update).toEqual([
        {
          id: 'f-1',
          contentTypeIdentifier: 'Product',
          fieldIdentifier: 'sku',
          changes: { unique: true },
        },
      ]);
      expect(plan.blockers).toEqual([]);
    });

    it('blocks unique false → true when duplicates exist (row 14)', () => {
      const plan = planSchema(
        fx.productUniqueSkuBundle,
        fx.snapshotProductSkuDuplicates
      );
      expect(plan.fields.update).toEqual([]);
      expect(plan.blockers).toHaveLength(1);
      expect(plan.blockers[0]!.code).toBe('UNIQUE_CONFLICT');
      expect(plan.blockers[0]!.path).toBe('fields.Product.sku');
      expect(plan.blockers[0]!.affectedEntryIds).toEqual([
        'e1',
        'e2',
        'e3',
        'e4',
      ]);
    });

    it('plans unique true → false always (row 15)', () => {
      const plan = planSchema(
        fx.productNonUniqueSkuBundle,
        fx.snapshotProductUniqueSku
      );
      expect(plan.fields.update).toEqual([
        {
          id: 'f-1',
          contentTypeIdentifier: 'Product',
          fieldIdentifier: 'sku',
          changes: { unique: false },
        },
      ]);
    });
  });

  describe('field-level: SELECT choice changes (rows 17, 18, 19)', () => {
    it('plans an options update when a choice is added (row 17)', () => {
      const plan = planSchema(
        fx.postCategoryThreeChoicesBundle,
        fx.snapshotPostCategoryTwoChoices
      );
      expect(plan.fields.update).toHaveLength(1);
      expect(plan.fields.update[0]!.changes.options).toEqual({
        choices: ['news', 'opinion', 'review'],
      });
      expect(plan.blockers).toEqual([]);
    });

    it('plans an options update when an unused choice is removed (row 18)', () => {
      const plan = planSchema(
        fx.postCategoryNewsOnlyBundle,
        fx.snapshotPostCategoryOpinionUnused
      );
      expect(plan.fields.update).toHaveLength(1);
      expect(plan.fields.update[0]!.changes.options).toEqual({
        choices: ['news'],
      });
      expect(plan.blockers).toEqual([]);
    });

    it('blocks removing a choice that entries reference (row 19)', () => {
      const plan = planSchema(
        fx.postCategoryNewsOnlyBundle,
        fx.snapshotPostCategoryOpinionInUse
      );
      expect(plan.fields.update).toEqual([]);
      expect(plan.blockers).toHaveLength(1);
      expect(plan.blockers[0]!.code).toBe('SELECT_CHOICE_REMOVED_IN_USE');
      expect(plan.blockers[0]!.path).toBe('fields.Post.category');
      expect(plan.blockers[0]!.message).toContain('opinion');
      expect(plan.blockers[0]!.message).toContain('2');
    });
  });

  describe('field-level: RELATION target changes (rows 20, 21, 22)', () => {
    it('plans an options update when a target is added (row 20)', () => {
      const plan = planSchema(
        fx.articleRelationTwoTargetsBundle,
        fx.snapshotArticleRelationOneTarget
      );
      expect(plan.fields.update).toHaveLength(1);
      expect(
        (plan.fields.update[0]!.changes.options as Record<string, unknown>)
          .targetContentTypeIdentifiers
      ).toEqual(['Author', 'Editor']);
      expect(plan.blockers).toEqual([]);
    });

    it('plans an options update when an unused target is removed (row 21)', () => {
      const plan = planSchema(
        fx.articleRelationOneTargetBundle,
        fx.snapshotArticleRelationEditorUnused
      );
      expect(plan.fields.update).toHaveLength(1);
      expect(plan.blockers).toEqual([]);
    });

    it('blocks removing a target with active relations (row 22)', () => {
      const plan = planSchema(
        fx.articleRelationOneTargetBothTypesBundle,
        fx.snapshotArticleRelationEditorInUse
      );
      expect(plan.fields.update).toEqual([]);
      expect(plan.blockers).toHaveLength(1);
      expect(plan.blockers[0]!.code).toBe('RELATION_TARGET_REMOVED_IN_USE');
      expect(plan.blockers[0]!.message).toContain('Editor');
    });
  });

  describe('field-level: RICHTEXT and unrecognised options (rows 23, 24)', () => {
    it('plans an options update for RICHTEXT allow-list change (row 23)', () => {
      const plan = planSchema(
        fx.articleRichtextAllowlistBundle,
        fx.snapshotArticleRichtextEmptyAllowlist
      );
      expect(plan.fields.update).toHaveLength(1);
      expect(plan.warnings).toEqual([]);
      expect(plan.blockers).toEqual([]);
    });

    it('warns on unrecognised option keys (row 24)', () => {
      const plan = planSchema(
        fx.articleUnknownOptionBundle,
        fx.snapshotArticleTaglineNoOptions
      );
      expect(plan.fields.update).toHaveLength(1);
      expect(plan.warnings).toHaveLength(1);
      expect(plan.warnings[0]!.code).toBe('UNRECOGNISED_FIELD_OPTION');
      expect(plan.warnings[0]!.message).toContain('newFutureOption');
    });
  });

  describe('field-level: type change blocker (row 16)', () => {
    it('blocks a field type change even with allowDestructive', () => {
      const plan = planSchema(
        fx.articleCountNumberBundle,
        fx.snapshotArticleCountText,
        { allowDestructive: true }
      );
      expect(plan.fields.update).toEqual([]);
      expect(plan.blockers).toHaveLength(1);
      expect(plan.blockers[0]!.code).toBe('FIELD_TYPE_CHANGE');
      expect(plan.blockers[0]!.path).toBe('fields.Article.count');
    });
  });

  describe('type-level: identifier change blocker (row 5)', () => {
    it('blocks an identifier change attempted via a non-portable bundle (id matches, identifier differs)', () => {
      const plan = planSchema(
        fx.articleIdentifierChangeBundle,
        fx.snapshotArticleUnchanged
      );
      expect(plan.blockers).toHaveLength(1);
      expect(plan.blockers[0]!.code).toBe('CONTENT_TYPE_IDENTIFIER_CHANGE');
      expect(plan.blockers[0]!.path).toBe('contentTypes.RenamedArticle');
      expect(plan.blockers[0]!.message).toContain('Article');
      expect(plan.blockers[0]!.message).toContain('RenamedArticle');
      // Suppress noise: no spurious create or removal blocker.
      expect(plan.contentTypes.create).toEqual([]);
      expect(plan.contentTypes.remove).toEqual([]);
      // Only the identifier-change blocker, not also a removal blocker
      // for the original type.
      expect(
        plan.blockers.filter((b) => b.code !== 'CONTENT_TYPE_IDENTIFIER_CHANGE')
      ).toEqual([]);
    });

    it('still blocks identifier change with allowDestructive (immutable, never unlocked)', () => {
      const plan = planSchema(
        fx.articleIdentifierChangeShortNameBundle,
        fx.snapshotArticleUnchanged,
        { allowDestructive: true }
      );
      expect(plan.blockers).toHaveLength(1);
      expect(plan.blockers[0]!.code).toBe('CONTENT_TYPE_IDENTIFIER_CHANGE');
    });

    it('falls back to remove+create for portable bundles (id is null, no detection signal)', () => {
      // Documented limitation: portable bundles strip ids, so a rename
      // is structurally indistinguishable from remove+add. The existing
      // CONTENT_TYPE_REMOVAL_NEEDS_FLAG blocker still gates this.
      const plan = planSchema(
        fx.articleRenamePortableBundle,
        fx.snapshotArticleUnchanged
      );
      expect(plan.contentTypes.create).toHaveLength(1);
      // The orphan triggers the standard removal blocker.
      expect(
        plan.blockers.some((b) => b.code === 'CONTENT_TYPE_REMOVAL_NEEDS_FLAG')
      ).toBe(true);
      expect(
        plan.blockers.some((b) => b.code === 'CONTENT_TYPE_IDENTIFIER_CHANGE')
      ).toBe(false);
    });
  });

  describe('cross-references', () => {
    it('resolves a RELATION targeting a type also in the bundle', () => {
      const plan = planSchema(fx.crossRefBundleAuthorInBundle, emptySnapshot);
      expect(plan.blockers).toEqual([]);
    });

    it('resolves a RELATION targeting a type already in the DB', () => {
      // Article is in the bundle; Author exists only in the DB snapshot (not
      // in the bundle). The cross-ref pass unions both sets, so Author is
      // known and no RELATION_TARGET_NOT_FOUND is emitted. Author being absent
      // from the bundle produces an unrelated CONTENT_TYPE_REMOVAL_NEEDS_FLAG
      // blocker — we assert only that the cross-ref blocker is absent.
      const plan = planSchema(
        fx.crossRefBundleAuthorInDb,
        fx.snapshotAuthorOnly
      );
      expect(
        plan.blockers.some((b) => b.code === 'RELATION_TARGET_NOT_FOUND')
      ).toBe(false);
    });

    it('blocks a RELATION targeting a type that exists in neither the bundle nor the DB', () => {
      const plan = planSchema(fx.crossRefBundleMissingTarget, emptySnapshot);
      expect(plan.blockers).toHaveLength(1);
      expect(plan.blockers[0]!.code).toBe('RELATION_TARGET_NOT_FOUND');
      expect(plan.blockers[0]!.path).toBe('fields.Article.author');
      expect(plan.blockers[0]!.message).toContain('MissingType');
    });
  });

  describe('plan ordering', () => {
    it('separates type creates from field creates so pass-1/pass-2 is preserved', () => {
      const plan = planSchema(
        fx.planOrderingBundle,
        fx.snapshotArticleTitleOnlyForOrdering
      );
      // Author is brand new → contentTypes.create with its fields embedded.
      // Article exists with the title field → no field create here.
      expect(plan.contentTypes.create).toHaveLength(1);
      expect(plan.contentTypes.create[0]!.identifier).toBe('Author');
      expect(plan.contentTypes.create[0]!.fields).toHaveLength(1);
      // No fields.create entry for Author — its fields ride along with the
      // type create. Pass 2 only handles fields against pre-existing types.
      expect(plan.fields.create).toEqual([]);
    });
  });

  describe('field-level: removal (rows 7, 8)', () => {
    it('blocks field removal without allowDestructive, no entries (row 7)', () => {
      const plan = planSchema(
        fx.articleTitleOnlyDropsFieldBundle,
        fx.snapshotArticleWithOldField
      );
      expect(plan.fields.remove).toEqual([]);
      expect(plan.blockers).toHaveLength(1);
      expect(plan.blockers[0]!.code).toBe('FIELD_REMOVAL_NEEDS_FLAG');
      expect(plan.blockers[0]!.path).toBe('fields.Article.oldField');
    });

    it('unlocks field removal with allowDestructive, no entries (row 7)', () => {
      const plan = planSchema(
        fx.articleTitleOnlyDropsFieldBundle,
        fx.snapshotArticleWithOldField,
        { allowDestructive: true }
      );
      expect(plan.blockers).toEqual([]);
      expect(plan.fields.remove).toEqual([
        {
          id: 'f-2',
          contentTypeIdentifier: 'Article',
          fieldIdentifier: 'oldField',
          entriesWithValue: 0,
        },
      ]);
    });

    it('unlocks field removal with allowDestructive when entries hold values, but surfaces a warning (row 8)', () => {
      const plan = planSchema(
        fx.articleTitleOnlyDropsFieldBundle,
        fx.snapshotArticleWithOldFieldValued,
        { allowDestructive: true }
      );
      expect(plan.fields.remove).toEqual([
        {
          id: 'f-2',
          contentTypeIdentifier: 'Article',
          fieldIdentifier: 'oldField',
          entriesWithValue: 5,
        },
      ]);
      expect(plan.warnings).toHaveLength(1);
      expect(plan.warnings[0]!.code).toBe('FIELD_REMOVAL_DATA_LOSS');
      expect(plan.warnings[0]!.path).toBe('fields.Article.oldField');
    });
  });

  describe('options equality edge cases', () => {
    it('treats {} on the bundle side and null on the DB side as equivalent (no spurious diff or warning)', () => {
      const plan = planSchema(
        fx.articleEmptyOptionsBundle,
        fx.snapshotArticleNullOptions
      );
      expect(plan.fields.update).toEqual([]);
      expect(plan.warnings).toEqual([]);
      expect(plan.blockers).toEqual([]);
    });

    it('treats null on the bundle side and {} on the DB side as equivalent (symmetric)', () => {
      const plan = planSchema(
        fx.articleNullOptionsBundle,
        fx.snapshotArticleEmptyOptions
      );
      expect(plan.fields.update).toEqual([]);
      expect(plan.warnings).toEqual([]);
      expect(plan.blockers).toEqual([]);
    });
  });
});
