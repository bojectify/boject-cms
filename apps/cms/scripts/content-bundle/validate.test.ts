import { describe, expect, it } from 'vitest';
import { validateBundle } from './validate';
import type { Bundle } from './types';

const baseContentType = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  identifier: 'BlogPost',
  name: 'Blog Post',
  description: null,
  fields: [
    {
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      identifier: 'title',
      name: 'Title',
      type: 'ENTRY_TITLE' as const,
      required: true,
      order: 0,
      options: null,
    },
  ],
};

const validBundle: Bundle = {
  version: 2,
  exportedAt: '2026-04-14T10:00:00.000Z',
  portable: false,
  contentTypes: [baseContentType],
  entries: [],
};

describe('validateBundle', () => {
  it('returns ok for a minimal valid bundle', () => {
    expect(validateBundle(validBundle)).toEqual({ ok: true, errors: [] });
  });

  it('accepts version 1', () => {
    const result = validateBundle({ ...validBundle, version: 1 });
    expect(result.ok).toBe(true);
  });

  it('rejects wrong version', () => {
    const result = validateBundle({ ...validBundle, version: 99 });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.path).toBe('version');
  });

  it('rejects missing ENTRY_TITLE field', () => {
    const result = validateBundle({
      ...validBundle,
      contentTypes: [
        {
          ...baseContentType,
          fields: [
            {
              id: null,
              identifier: 'body',
              name: 'Body',
              type: 'TEXT',
              required: false,
              order: 0,
              options: null,
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.message).toMatch(/ENTRY_TITLE/);
  });

  it('rejects SELECT field without choices', () => {
    const result = validateBundle({
      ...validBundle,
      contentTypes: [
        {
          ...baseContentType,
          fields: [
            ...baseContentType.fields,
            {
              id: null,
              identifier: 'status',
              name: 'Status',
              type: 'SELECT',
              required: false,
              order: 1,
              options: {},
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.path).toMatch(/contentTypes\[0\]\.fields\[1\]/);
  });

  it('rejects RELATION field missing targetContentTypeIds and identifiers', () => {
    const result = validateBundle({
      ...validBundle,
      contentTypes: [
        {
          ...baseContentType,
          fields: [
            ...baseContentType.fields,
            {
              id: null,
              identifier: 'author',
              name: 'Author',
              type: 'RELATION',
              required: false,
              order: 1,
              options: {},
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.message).toMatch(/target/);
  });

  it('rejects portable bundle with missing entryTitle on entry', () => {
    const result = validateBundle({
      ...validBundle,
      portable: true,
      entries: [
        {
          id: null,
          contentTypeId: null,
          contentTypeIdentifier: 'BlogPost',
          entryTitle: '',
          slug: null,
          status: 'DRAFT',
          publishedAt: null,
          data: { title: 'x' },
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.path).toMatch(/entryTitle/);
  });
});
