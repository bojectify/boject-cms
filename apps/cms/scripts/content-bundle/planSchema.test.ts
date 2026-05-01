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
