// scripts/build-starters/validate.test.ts
import { describe, expect, it } from 'vitest';
import { validateOverlay, validateFieldPartial } from './validate';
import { FIELD_TYPES } from '../../utils/fieldTypes';

const baseOverlay = {
  version: 1,
  name: 'sport',
  extends: 'base',
  contentTypes: [
    {
      identifier: 'Team',
      mode: 'create',
      name: 'Team',
      description: null,
      fields: [
        {
          id: null,
          identifier: 'name',
          name: 'Name',
          type: FIELD_TYPES.ENTRY_TITLE,
          required: true,
          order: 0,
          options: null,
        },
      ],
    },
  ],
};

describe('validateOverlay', () => {
  it('accepts a minimal valid overlay', () => {
    expect(validateOverlay(baseOverlay)).toEqual({ ok: true, errors: [] });
  });

  it('requires version 1', () => {
    const bad = { ...baseOverlay, version: 2 };
    const res = validateOverlay(bad);
    expect(res.ok).toBe(false);
    expect(res.errors[0]!.path).toBe('version');
  });

  it('requires a non-empty name', () => {
    const res = validateOverlay({ ...baseOverlay, name: '' });
    expect(res.ok).toBe(false);
    expect(res.errors.find((e) => e.path === 'name')).toBeDefined();
  });

  it('allows extends to be null (root bundle)', () => {
    const res = validateOverlay({ ...baseOverlay, extends: null });
    expect(res.ok).toBe(true);
  });

  it('requires extends to be string or null', () => {
    const res = validateOverlay({ ...baseOverlay, extends: 42 });
    expect(res.ok).toBe(false);
  });

  it('defaults mode to "create" and validates', () => {
    const ct = { ...baseOverlay.contentTypes[0] } as Record<string, unknown>;
    delete ct.mode;
    const res = validateOverlay({ ...baseOverlay, contentTypes: [ct] });
    expect(res.ok).toBe(true);
  });

  it('rejects unknown mode', () => {
    const ct = { ...baseOverlay.contentTypes[0], mode: 'replace' };
    const res = validateOverlay({ ...baseOverlay, contentTypes: [ct] });
    expect(res.ok).toBe(false);
  });

  it('requires name on create mode', () => {
    const ct = { ...baseOverlay.contentTypes[0] } as Record<string, unknown>;
    delete ct.name;
    const res = validateOverlay({ ...baseOverlay, contentTypes: [ct] });
    expect(res.ok).toBe(false);
    expect(res.errors.find((e) => e.path.endsWith('.name'))).toBeDefined();
  });

  it('allows patch mode without name', () => {
    const ct = {
      identifier: 'Player',
      mode: 'patch',
      fields: [
        {
          id: null,
          identifier: 'position',
          name: 'Position',
          type: FIELD_TYPES.RELATION,
          required: false,
          order: 10,
          options: {
            targetContentTypeIds: [null],
            targetContentTypeIdentifiers: ['Position'],
          },
        },
      ],
    };
    const res = validateOverlay({ ...baseOverlay, contentTypes: [ct] });
    expect(res.ok).toBe(true);
  });

  it('does NOT require exactly one ENTRY_TITLE in patch mode', () => {
    const ct = {
      identifier: 'Player',
      mode: 'patch',
      fields: [
        {
          id: null,
          identifier: 'position',
          name: 'Position',
          type: FIELD_TYPES.TEXT,
          required: false,
          order: 5,
          options: null,
        },
      ],
    };
    const res = validateOverlay({ ...baseOverlay, contentTypes: [ct] });
    expect(res.ok).toBe(true);
  });

  it('requires exactly one ENTRY_TITLE in create mode', () => {
    const ct = {
      identifier: 'Team',
      mode: 'create',
      name: 'Team',
      description: null,
      fields: [
        {
          id: null,
          identifier: 'slug',
          name: 'Slug',
          type: FIELD_TYPES.SLUG,
          required: false,
          order: 0,
          options: null,
        },
      ],
    };
    const res = validateOverlay({ ...baseOverlay, contentTypes: [ct] });
    expect(res.ok).toBe(false);
    expect(
      res.errors.find((e) => e.message.includes(FIELD_TYPES.ENTRY_TITLE))
    ).toBeDefined();
  });
});

describe('validateOverlay — array extends & content-type extends', () => {
  it('accepts extends as an array of strings', () => {
    const r = validateOverlay({
      ...baseOverlay,
      extends: ['web-base', 'taxonomy'],
    });
    expect(r.ok).toBe(true);
  });
  it('rejects a non-string entry in extends[]', () => {
    const r = validateOverlay({ ...baseOverlay, extends: ['web-base', 123] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === 'extends[1]')).toBe(true);
  });
  it('accepts a content type with extends: string[]', () => {
    const r = validateOverlay({
      ...baseOverlay,
      contentTypes: [
        { ...baseOverlay.contentTypes[0], extends: ['web-metadata'] },
      ],
    });
    expect(r.ok).toBe(true);
  });
  it('rejects a non-array content-type extends', () => {
    const r = validateOverlay({
      ...baseOverlay,
      contentTypes: [
        { ...baseOverlay.contentTypes[0], extends: 'web-metadata' },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path.endsWith('.extends'))).toBe(true);
  });
  it('rejects extends on a patch-mode content type', () => {
    const r = validateOverlay({
      ...baseOverlay,
      contentTypes: [
        {
          identifier: 'Player',
          mode: 'patch',
          extends: ['web-metadata'],
          fields: [
            {
              id: null,
              identifier: 'position',
              name: 'Position',
              type: FIELD_TYPES.TEXT,
              required: false,
              order: 5,
              options: null,
            },
          ],
        },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path.endsWith('.extends'))).toBe(true);
  });
  it('accepts extends on a create-mode content type', () => {
    const r = validateOverlay({
      ...baseOverlay,
      contentTypes: [
        { ...baseOverlay.contentTypes[0], extends: ['web-metadata'] },
      ],
    });
    expect(r.ok).toBe(true);
  });
});

describe('validateFieldPartial', () => {
  const good = {
    name: 'web-metadata',
    fields: [
      {
        id: null,
        identifier: 'metaTitle',
        name: 'Meta Title',
        type: FIELD_TYPES.TEXT,
        required: false,
        order: 0,
        options: null,
      },
    ],
  };
  it('accepts a valid field-partial', () => {
    expect(validateFieldPartial(good)).toEqual({ ok: true, errors: [] });
  });
  it('requires a name', () => {
    expect(validateFieldPartial({ ...good, name: '' }).ok).toBe(false);
  });
  it('rejects an ENTRY_TITLE field (patch-mode rule)', () => {
    const r = validateFieldPartial({
      ...good,
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
      ],
    });
    expect(r.ok).toBe(false);
  });
});
