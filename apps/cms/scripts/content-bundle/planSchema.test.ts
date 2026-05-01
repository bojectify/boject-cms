import { describe, expect, it } from 'vitest';
import { planSchema } from './planSchema';
import type { Bundle, CurrentSchemaSnapshot } from './schemaPlan.types';

const emptySnapshot: CurrentSchemaSnapshot = {
  contentTypes: [],
  fieldUsage: new Map(),
};

const emptyBundle: Bundle = {
  version: 2,
  exportedAt: '2026-05-01T00:00:00.000Z',
  portable: true,
  contentTypes: [],
};

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
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [],
          },
        ],
      };
      const plan = planSchema(bundle, emptySnapshot);
      expect(plan.contentTypes.create).toHaveLength(1);
      expect(plan.contentTypes.create[0]!.identifier).toBe('Article');
      expect(plan.contentTypes.update).toEqual([]);
    });

    it('plans a name update when the name differs (row 4)', () => {
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Article',
            name: 'New Name',
            description: 'unchanged',
            fields: [],
          },
        ],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Article',
            name: 'Old Name',
            description: 'unchanged',
            fields: [],
            entryCount: 0,
          },
        ],
        fieldUsage: new Map(),
      };
      const plan = planSchema(bundle, snapshot);
      expect(plan.contentTypes.update).toEqual([
        { id: 'ct-1', identifier: 'Article', changes: { name: 'New Name' } },
      ]);
      expect(plan.contentTypes.create).toEqual([]);
    });

    it('plans a description-only update (row 4)', () => {
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Article',
            name: 'Article',
            description: 'New description',
            fields: [],
          },
        ],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [],
            entryCount: 0,
          },
        ],
        fieldUsage: new Map(),
      };
      const plan = planSchema(bundle, snapshot);
      expect(plan.contentTypes.update).toEqual([
        {
          id: 'ct-1',
          identifier: 'Article',
          changes: { description: 'New description' },
        },
      ]);
    });

    it('does not plan an update when the type matches exactly', () => {
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [],
          },
        ],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [],
            entryCount: 0,
          },
        ],
        fieldUsage: new Map(),
      };
      const plan = planSchema(bundle, snapshot);
      expect(plan.contentTypes.create).toEqual([]);
      expect(plan.contentTypes.update).toEqual([]);
    });
  });

  describe('type-level: removal (rows 2, 3)', () => {
    it('blocks removal of an empty content type without allowDestructive (row 2)', () => {
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'OrphanType',
            name: 'Orphan',
            description: null,
            fields: [],
            entryCount: 0,
          },
        ],
        fieldUsage: new Map(),
      };
      const plan = planSchema(bundle, snapshot);
      expect(plan.blockers).toHaveLength(1);
      expect(plan.blockers[0]!.code).toBe('CONTENT_TYPE_REMOVAL_NEEDS_FLAG');
      expect(plan.blockers[0]!.path).toBe('contentTypes.OrphanType');
      expect(plan.contentTypes.remove).toEqual([]);
    });

    it('unlocks removal of an empty content type with allowDestructive (row 2)', () => {
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'OrphanType',
            name: 'Orphan',
            description: null,
            fields: [],
            entryCount: 0,
          },
        ],
        fieldUsage: new Map(),
      };
      const plan = planSchema(bundle, snapshot, { allowDestructive: true });
      expect(plan.blockers).toEqual([]);
      expect(plan.contentTypes.remove).toEqual([
        { id: 'ct-1', identifier: 'OrphanType', entryCount: 0 },
      ]);
    });

    it('blocks removal of a content type with entries even with allowDestructive (row 3)', () => {
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-2',
            identifier: 'PopulatedType',
            name: 'Populated',
            description: null,
            fields: [],
            entryCount: 17,
          },
        ],
        fieldUsage: new Map(),
      };
      const plan = planSchema(bundle, snapshot, { allowDestructive: true });
      expect(plan.blockers).toHaveLength(1);
      expect(plan.blockers[0]!.code).toBe('CONTENT_TYPE_REMOVAL_WITH_ENTRIES');
      expect(plan.blockers[0]!.path).toBe('contentTypes.PopulatedType');
      expect(plan.contentTypes.remove).toEqual([]);
    });
  });

  describe('field-level: create on existing type (row 6)', () => {
    it('plans a field create on an existing type when no entries exist (safe)', () => {
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
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
                type: 'ENTRY_TITLE',
                required: true,
                order: 0,
                options: null,
              },
              {
                id: null,
                identifier: 'tagline',
                name: 'Tagline',
                type: 'TEXT',
                required: false,
                order: 1,
                options: null,
              },
            ],
          },
        ],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [
              {
                id: 'f-1',
                identifier: 'title',
                name: 'Title',
                type: 'ENTRY_TITLE',
                required: true,
                unique: true,
                order: 0,
                options: null,
              },
            ],
            entryCount: 0,
          },
        ],
        fieldUsage: new Map(),
      };
      const plan = planSchema(bundle, snapshot);
      expect(plan.fields.create).toHaveLength(1);
      expect(plan.fields.create[0]!.contentTypeIdentifier).toBe('Article');
      expect(plan.fields.create[0]!.field.identifier).toBe('tagline');
      expect(plan.warnings).toEqual([]);
    });

    it('blocks a field-identifier change attempted via a non-portable bundle', () => {
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: false,
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [
              {
                id: 'f-1',
                identifier: 'title',
                name: 'Title',
                type: 'ENTRY_TITLE',
                required: true,
                order: 0,
                options: null,
              },
              {
                id: 'f-2',
                identifier: 'renamedTagline',
                name: 'Tagline',
                type: 'TEXT',
                required: false,
                order: 1,
                options: null,
              },
            ],
          },
        ],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [
              {
                id: 'f-1',
                identifier: 'title',
                name: 'Title',
                type: 'ENTRY_TITLE',
                required: true,
                unique: true,
                order: 0,
                options: null,
              },
              {
                id: 'f-2',
                identifier: 'tagline',
                name: 'Tagline',
                type: 'TEXT',
                required: false,
                unique: false,
                order: 1,
                options: null,
              },
            ],
            entryCount: 0,
          },
        ],
        fieldUsage: new Map(),
      };
      const plan = planSchema(bundle, snapshot);
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
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
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
                type: 'ENTRY_TITLE',
                required: true,
                order: 0,
                options: null,
              },
              {
                id: null,
                identifier: 'category',
                name: 'Category',
                type: 'TEXT',
                required: true,
                order: 1,
                options: null,
              },
            ],
          },
        ],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [
              {
                id: 'f-1',
                identifier: 'title',
                name: 'Title',
                type: 'ENTRY_TITLE',
                required: true,
                unique: true,
                order: 0,
                options: null,
              },
            ],
            entryCount: 5,
          },
        ],
        fieldUsage: new Map(),
      };
      const plan = planSchema(bundle, snapshot);
      expect(plan.fields.create).toHaveLength(1);
      expect(plan.warnings).toHaveLength(1);
      expect(plan.warnings[0]!.code).toBe('NEW_REQUIRED_FIELD_WITH_ENTRIES');
      expect(plan.warnings[0]!.path).toBe('fields.Article.category');
    });
  });

  describe('field-level: name and order updates (row 9)', () => {
    it('plans a name update', () => {
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
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
                name: 'Renamed Title',
                type: 'ENTRY_TITLE',
                required: true,
                order: 0,
                options: null,
              },
            ],
          },
        ],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [
              {
                id: 'f-1',
                identifier: 'title',
                name: 'Title',
                type: 'ENTRY_TITLE',
                required: true,
                unique: true,
                order: 0,
                options: null,
              },
            ],
            entryCount: 0,
          },
        ],
        fieldUsage: new Map(),
      };
      const plan = planSchema(bundle, snapshot);
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
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
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
                type: 'ENTRY_TITLE',
                required: true,
                order: 5,
                options: null,
              },
            ],
          },
        ],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [
              {
                id: 'f-1',
                identifier: 'title',
                name: 'Title',
                type: 'ENTRY_TITLE',
                required: true,
                unique: true,
                order: 0,
                options: null,
              },
            ],
            entryCount: 0,
          },
        ],
        fieldUsage: new Map(),
      };
      const plan = planSchema(bundle, snapshot);
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
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [
              {
                id: null,
                identifier: 'tagline',
                name: 'Tagline',
                type: 'TEXT',
                required: true,
                order: 0,
                options: null,
              },
            ],
          },
        ],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [
              {
                id: 'f-1',
                identifier: 'tagline',
                name: 'Tagline',
                type: 'TEXT',
                required: false,
                unique: false,
                order: 0,
                options: null,
              },
            ],
            entryCount: 3,
          },
        ],
        fieldUsage: new Map([['Article:tagline', { entriesWithValue: 3 }]]),
      };
      const plan = planSchema(bundle, snapshot);
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
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [
              {
                id: null,
                identifier: 'tagline',
                name: 'Tagline',
                type: 'TEXT',
                required: true,
                order: 0,
                options: null,
              },
            ],
          },
        ],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [
              {
                id: 'f-1',
                identifier: 'tagline',
                name: 'Tagline',
                type: 'TEXT',
                required: false,
                unique: false,
                order: 0,
                options: null,
              },
            ],
            entryCount: 5,
          },
        ],
        fieldUsage: new Map([['Article:tagline', { entriesWithValue: 3 }]]),
      };
      const plan = planSchema(bundle, snapshot);
      expect(plan.fields.update).toEqual([]);
      expect(plan.blockers).toHaveLength(1);
      expect(plan.blockers[0]!.code).toBe('OPTIONAL_TO_REQUIRED_HAS_NULLS');
      expect(plan.blockers[0]!.path).toBe('fields.Article.tagline');
      expect(plan.blockers[0]!.message).toContain('2'); // 5 - 3 = 2 missing
    });

    it('plans required → optional always (row 12)', () => {
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [
              {
                id: null,
                identifier: 'tagline',
                name: 'Tagline',
                type: 'TEXT',
                required: false,
                order: 0,
                options: null,
              },
            ],
          },
        ],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [
              {
                id: 'f-1',
                identifier: 'tagline',
                name: 'Tagline',
                type: 'TEXT',
                required: true,
                unique: false,
                order: 0,
                options: null,
              },
            ],
            entryCount: 99,
          },
        ],
        fieldUsage: new Map(),
      };
      const plan = planSchema(bundle, snapshot);
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
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Product',
            name: 'Product',
            description: null,
            fields: [
              {
                id: null,
                identifier: 'sku',
                name: 'SKU',
                type: 'TEXT',
                required: false,
                unique: true,
                order: 0,
                options: null,
              },
            ],
          },
        ],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Product',
            name: 'Product',
            description: null,
            fields: [
              {
                id: 'f-1',
                identifier: 'sku',
                name: 'SKU',
                type: 'TEXT',
                required: false,
                unique: false,
                order: 0,
                options: null,
              },
            ],
            entryCount: 3,
          },
        ],
        fieldUsage: new Map([
          ['Product:sku', { entriesWithValue: 3, duplicateValues: [] }],
        ]),
      };
      const plan = planSchema(bundle, snapshot);
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
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Product',
            name: 'Product',
            description: null,
            fields: [
              {
                id: null,
                identifier: 'sku',
                name: 'SKU',
                type: 'TEXT',
                required: false,
                unique: true,
                order: 0,
                options: null,
              },
            ],
          },
        ],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Product',
            name: 'Product',
            description: null,
            fields: [
              {
                id: 'f-1',
                identifier: 'sku',
                name: 'SKU',
                type: 'TEXT',
                required: false,
                unique: false,
                order: 0,
                options: null,
              },
            ],
            entryCount: 4,
          },
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
      };
      const plan = planSchema(bundle, snapshot);
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
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Product',
            name: 'Product',
            description: null,
            fields: [
              {
                id: null,
                identifier: 'sku',
                name: 'SKU',
                type: 'TEXT',
                required: false,
                unique: false,
                order: 0,
                options: null,
              },
            ],
          },
        ],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Product',
            name: 'Product',
            description: null,
            fields: [
              {
                id: 'f-1',
                identifier: 'sku',
                name: 'SKU',
                type: 'TEXT',
                required: false,
                unique: true,
                order: 0,
                options: null,
              },
            ],
            entryCount: 99,
          },
        ],
        fieldUsage: new Map(),
      };
      const plan = planSchema(bundle, snapshot);
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
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Post',
            name: 'Post',
            description: null,
            fields: [
              {
                id: null,
                identifier: 'category',
                name: 'Category',
                type: 'SELECT',
                required: false,
                order: 0,
                options: { choices: ['news', 'opinion', 'review'] },
              },
            ],
          },
        ],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Post',
            name: 'Post',
            description: null,
            fields: [
              {
                id: 'f-1',
                identifier: 'category',
                name: 'Category',
                type: 'SELECT',
                required: false,
                unique: false,
                order: 0,
                options: { choices: ['news', 'opinion'] },
              },
            ],
            entryCount: 0,
          },
        ],
        fieldUsage: new Map(),
      };
      const plan = planSchema(bundle, snapshot);
      expect(plan.fields.update).toHaveLength(1);
      expect(plan.fields.update[0]!.changes.options).toEqual({
        choices: ['news', 'opinion', 'review'],
      });
      expect(plan.blockers).toEqual([]);
    });

    it('plans an options update when an unused choice is removed (row 18)', () => {
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Post',
            name: 'Post',
            description: null,
            fields: [
              {
                id: null,
                identifier: 'category',
                name: 'Category',
                type: 'SELECT',
                required: false,
                order: 0,
                options: { choices: ['news'] },
              },
            ],
          },
        ],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Post',
            name: 'Post',
            description: null,
            fields: [
              {
                id: 'f-1',
                identifier: 'category',
                name: 'Category',
                type: 'SELECT',
                required: false,
                unique: false,
                order: 0,
                options: { choices: ['news', 'opinion'] },
              },
            ],
            entryCount: 5,
          },
        ],
        fieldUsage: new Map([
          [
            'Post:category',
            {
              entriesWithValue: 5,
              selectChoiceCounts: new Map([['news', 5]]),
            },
          ],
        ]),
      };
      const plan = planSchema(bundle, snapshot);
      expect(plan.fields.update).toHaveLength(1);
      expect(plan.fields.update[0]!.changes.options).toEqual({
        choices: ['news'],
      });
      expect(plan.blockers).toEqual([]);
    });

    it('blocks removing a choice that entries reference (row 19)', () => {
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Post',
            name: 'Post',
            description: null,
            fields: [
              {
                id: null,
                identifier: 'category',
                name: 'Category',
                type: 'SELECT',
                required: false,
                order: 0,
                options: { choices: ['news'] },
              },
            ],
          },
        ],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Post',
            name: 'Post',
            description: null,
            fields: [
              {
                id: 'f-1',
                identifier: 'category',
                name: 'Category',
                type: 'SELECT',
                required: false,
                unique: false,
                order: 0,
                options: { choices: ['news', 'opinion'] },
              },
            ],
            entryCount: 6,
          },
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
      };
      const plan = planSchema(bundle, snapshot);
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
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [
              {
                id: null,
                identifier: 'author',
                name: 'Author',
                type: 'RELATION',
                required: false,
                order: 0,
                options: {
                  targetContentTypeIdentifiers: ['Author', 'Editor'],
                },
              },
            ],
          },
        ],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [
              {
                id: 'f-1',
                identifier: 'author',
                name: 'Author',
                type: 'RELATION',
                required: false,
                unique: false,
                order: 0,
                options: {
                  targetContentTypeIdentifiers: ['Author'],
                },
              },
            ],
            entryCount: 0,
          },
        ],
        fieldUsage: new Map(),
      };
      const plan = planSchema(bundle, snapshot);
      expect(plan.fields.update).toHaveLength(1);
      expect(
        (plan.fields.update[0]!.changes.options as Record<string, unknown>)
          .targetContentTypeIdentifiers
      ).toEqual(['Author', 'Editor']);
      expect(plan.blockers).toEqual([]);
    });

    it('plans an options update when an unused target is removed (row 21)', () => {
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [
              {
                id: null,
                identifier: 'author',
                name: 'Author',
                type: 'RELATION',
                required: false,
                order: 0,
                options: { targetContentTypeIdentifiers: ['Author'] },
              },
            ],
          },
        ],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [
              {
                id: 'f-1',
                identifier: 'author',
                name: 'Author',
                type: 'RELATION',
                required: false,
                unique: false,
                order: 0,
                options: { targetContentTypeIdentifiers: ['Author', 'Editor'] },
              },
            ],
            entryCount: 4,
          },
        ],
        fieldUsage: new Map([
          [
            'Article:author',
            {
              entriesWithValue: 4,
              relationTargetCounts: new Map([['Author', 4]]),
            },
          ],
        ]),
      };
      const plan = planSchema(bundle, snapshot);
      expect(plan.fields.update).toHaveLength(1);
      expect(plan.blockers).toEqual([]);
    });

    it('blocks removing a target with active relations (row 22)', () => {
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [
              {
                id: null,
                identifier: 'author',
                name: 'Author',
                type: 'RELATION',
                required: false,
                order: 0,
                options: { targetContentTypeIdentifiers: ['Author'] },
              },
            ],
          },
        ],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [
              {
                id: 'f-1',
                identifier: 'author',
                name: 'Author',
                type: 'RELATION',
                required: false,
                unique: false,
                order: 0,
                options: { targetContentTypeIdentifiers: ['Author', 'Editor'] },
              },
            ],
            entryCount: 6,
          },
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
      };
      const plan = planSchema(bundle, snapshot);
      expect(plan.fields.update).toEqual([]);
      expect(plan.blockers).toHaveLength(1);
      expect(plan.blockers[0]!.code).toBe('RELATION_TARGET_REMOVED_IN_USE');
      expect(plan.blockers[0]!.message).toContain('Editor');
    });
  });

  describe('field-level: RICHTEXT and unrecognised options (rows 23, 24)', () => {
    it('plans an options update for RICHTEXT allow-list change (row 23)', () => {
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [
              {
                id: null,
                identifier: 'body',
                name: 'Body',
                type: 'RICHTEXT',
                required: false,
                order: 0,
                options: { targetContentTypeIds: ['ct-img'] },
              },
            ],
          },
        ],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [
              {
                id: 'f-1',
                identifier: 'body',
                name: 'Body',
                type: 'RICHTEXT',
                required: false,
                unique: false,
                order: 0,
                options: { targetContentTypeIds: [] },
              },
            ],
            entryCount: 99,
          },
        ],
        fieldUsage: new Map(),
      };
      const plan = planSchema(bundle, snapshot);
      expect(plan.fields.update).toHaveLength(1);
      expect(plan.warnings).toEqual([]);
      expect(plan.blockers).toEqual([]);
    });

    it('warns on unrecognised option keys (row 24)', () => {
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [
              {
                id: null,
                identifier: 'tagline',
                name: 'Tagline',
                type: 'TEXT',
                required: false,
                order: 0,
                options: { newFutureOption: true },
              },
            ],
          },
        ],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [
              {
                id: 'f-1',
                identifier: 'tagline',
                name: 'Tagline',
                type: 'TEXT',
                required: false,
                unique: false,
                order: 0,
                options: null,
              },
            ],
            entryCount: 0,
          },
        ],
        fieldUsage: new Map(),
      };
      const plan = planSchema(bundle, snapshot);
      expect(plan.fields.update).toHaveLength(1);
      expect(plan.warnings).toHaveLength(1);
      expect(plan.warnings[0]!.code).toBe('UNRECOGNISED_FIELD_OPTION');
      expect(plan.warnings[0]!.message).toContain('newFutureOption');
    });
  });

  describe('field-level: type change blocker (row 16)', () => {
    it('blocks a field type change even with allowDestructive', () => {
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [
              {
                id: null,
                identifier: 'count',
                name: 'Count',
                type: 'NUMBER',
                required: false,
                order: 0,
                options: null,
              },
            ],
          },
        ],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [
              {
                id: 'f-1',
                identifier: 'count',
                name: 'Count',
                type: 'TEXT',
                required: false,
                unique: false,
                order: 0,
                options: null,
              },
            ],
            entryCount: 0,
          },
        ],
        fieldUsage: new Map(),
      };
      const plan = planSchema(bundle, snapshot, { allowDestructive: true });
      expect(plan.fields.update).toEqual([]);
      expect(plan.blockers).toHaveLength(1);
      expect(plan.blockers[0]!.code).toBe('FIELD_TYPE_CHANGE');
      expect(plan.blockers[0]!.path).toBe('fields.Article.count');
    });
  });

  describe('type-level: identifier change blocker (row 5)', () => {
    it('blocks an identifier change attempted via a non-portable bundle (id matches, identifier differs)', () => {
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: false,
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'RenamedArticle',
            name: 'Renamed Article',
            description: null,
            fields: [],
          },
        ],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [],
            entryCount: 0,
          },
        ],
        fieldUsage: new Map(),
      };
      const plan = planSchema(bundle, snapshot);
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
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: false,
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'RenamedArticle',
            name: 'Renamed',
            description: null,
            fields: [],
          },
        ],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [],
            entryCount: 0,
          },
        ],
        fieldUsage: new Map(),
      };
      const plan = planSchema(bundle, snapshot, { allowDestructive: true });
      expect(plan.blockers).toHaveLength(1);
      expect(plan.blockers[0]!.code).toBe('CONTENT_TYPE_IDENTIFIER_CHANGE');
    });

    it('falls back to remove+create for portable bundles (id is null, no detection signal)', () => {
      // Documented limitation: portable bundles strip ids, so a rename
      // is structurally indistinguishable from remove+add. The existing
      // CONTENT_TYPE_REMOVAL_NEEDS_FLAG blocker still gates this.
      const bundle: Bundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'RenamedArticle',
            name: 'Renamed',
            description: null,
            fields: [],
          },
        ],
      };
      const snapshot: CurrentSchemaSnapshot = {
        contentTypes: [
          {
            id: 'ct-1',
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [],
            entryCount: 0,
          },
        ],
        fieldUsage: new Map(),
      };
      const plan = planSchema(bundle, snapshot);
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
});
