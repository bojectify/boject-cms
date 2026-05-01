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
});
