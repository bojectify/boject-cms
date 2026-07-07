import { describe, expect, it } from 'vitest';
import { validateSchemaBundle } from './validateSchemaBundle.js';

const validBundle = {
  version: 2,
  exportedAt: '2026-07-07T00:00:00.000Z',
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
      ],
    },
  ],
};

describe('validateSchemaBundle', () => {
  it('returns ok for a valid schema-only bundle', () => {
    const r = validateSchemaBundle(validBundle);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('flags shape errors with kind "shape"', () => {
    const r = validateSchemaBundle({ ...validBundle, version: 1 });
    expect(r.ok).toBe(false);
    expect(
      r.issues.some((i) => i.kind === 'shape' && i.path === 'version')
    ).toBe(true);
  });

  it('flags a relation to an unknown content type with kind "plan"', () => {
    const bundle = {
      ...validBundle,
      contentTypes: [
        {
          ...validBundle.contentTypes[0],
          fields: [
            ...validBundle.contentTypes[0].fields,
            {
              id: null,
              identifier: 'author',
              name: 'Author',
              type: 'RELATION',
              required: false,
              order: 1,
              options: { targetContentTypeIdentifiers: ['Ghost'] },
            },
          ],
        },
      ],
    };
    const r = validateSchemaBundle(bundle);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.kind === 'plan')).toBe(true);
  });
});
