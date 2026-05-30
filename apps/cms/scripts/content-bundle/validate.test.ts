import { describe, expect, it } from 'vitest';
import { validateBundle } from './validate';
import { BUNDLE_VERSION, type Bundle } from './types';
import { FIELD_TYPES } from '../../utils/fieldTypes';
import {
  CONTENT_STATUSES,
  type ContentStatusName,
} from '../../utils/contentStatus';

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
      type: FIELD_TYPES.ENTRY_TITLE,
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
              type: FIELD_TYPES.TEXT,
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
              type: FIELD_TYPES.SELECT,
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
              type: FIELD_TYPES.RELATION,
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
          status: CONTENT_STATUSES.DRAFT,
          publishedAt: null,
          data: { title: 'x' },
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.path).toMatch(/entryTitle/);
  });
});

describe('entryKey validation (#205)', () => {
  it('rejects a bundle with an entry missing entryKey', () => {
    const bundle = {
      version: 2,
      exportedAt: '2026-05-13T00:00:00.000Z',
      portable: true,
      entries: [
        {
          id: null,
          contentTypeId: null,
          contentTypeIdentifier: 'Post',
          entryTitle: 'Hello',
          slug: 'hello',
          versions: [
            { status: CONTENT_STATUSES.PUBLISHED, data: {}, publishedAt: null },
          ],
        },
      ],
    };
    const result = validateBundle(bundle as never);
    expect(result.ok).toBe(false);
    expect(
      result.errors.find((e) => e.path === 'entries[0].entryKey')
    ).toBeDefined();
  });

  it('rejects a bundle with an entry whose entryKey is an empty string', () => {
    const bundle = {
      version: 2,
      exportedAt: '2026-05-13T00:00:00.000Z',
      portable: true,
      entries: [
        {
          id: null,
          contentTypeId: null,
          contentTypeIdentifier: 'Post',
          entryTitle: 'Hello',
          entryKey: '',
          slug: 'hello',
          versions: [
            { status: CONTENT_STATUSES.PUBLISHED, data: {}, publishedAt: null },
          ],
        },
      ],
    };
    const result = validateBundle(bundle as never);
    expect(result.ok).toBe(false);
    expect(
      result.errors.find((e) => e.path === 'entries[0].entryKey')
    ).toBeDefined();
  });

  it('rejects a bundle with duplicate entryKey within a contentTypeIdentifier', () => {
    const bundle = {
      version: 2,
      exportedAt: '2026-05-13T00:00:00.000Z',
      portable: true,
      entries: [
        {
          id: null,
          contentTypeId: null,
          contentTypeIdentifier: 'Post',
          entryTitle: 'A',
          entryKey: 'a',
          slug: null,
          versions: [
            { status: CONTENT_STATUSES.PUBLISHED, data: {}, publishedAt: null },
          ],
        },
        {
          id: null,
          contentTypeId: null,
          contentTypeIdentifier: 'Post',
          entryTitle: 'B',
          entryKey: 'a',
          slug: null,
          versions: [
            { status: CONTENT_STATUSES.PUBLISHED, data: {}, publishedAt: null },
          ],
        },
      ],
    };
    const result = validateBundle(bundle as never);
    expect(result.ok).toBe(false);
    expect(
      result.errors.find((e) => e.message.includes('duplicate entryKey'))
    ).toBeDefined();
  });

  it('allows the same entryKey across different contentTypeIdentifiers', () => {
    const bundle = {
      version: 2,
      exportedAt: '2026-05-13T00:00:00.000Z',
      portable: true,
      entries: [
        {
          id: null,
          contentTypeId: null,
          contentTypeIdentifier: 'Post',
          entryTitle: 'A',
          entryKey: 'shared',
          slug: null,
          versions: [
            { status: CONTENT_STATUSES.PUBLISHED, data: {}, publishedAt: null },
          ],
        },
        {
          id: null,
          contentTypeId: null,
          contentTypeIdentifier: 'Author',
          entryTitle: 'A',
          entryKey: 'shared',
          slug: null,
          versions: [
            { status: CONTENT_STATUSES.PUBLISHED, data: {}, publishedAt: null },
          ],
        },
      ],
    };
    const result = validateBundle(bundle as never);
    // ContentTypes are absent (this bundle is entries-only and references types
    // by identifier — the validator may surface that as a separate failure
    // unrelated to entryKey). What we care about: NO duplicate-entryKey error.
    expect(
      result.errors.find((e) => e.message.includes('duplicate entryKey'))
    ).toBeUndefined();
  });
});

describe('validateBundle — version tightening', () => {
  it('rejects bundles claiming version 1', () => {
    const bundle = { ...validBundle, version: 1 };
    const result = validateBundle(bundle);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatchObject({ path: 'version' });
    expect(result.errors[0]?.message).toMatch(/expected version 2, got 1/);
    expect(result.errors[0]?.message).toMatch(/boject bundle migrate/);
  });

  it('rejects bundles claiming a future version', () => {
    const bundle = { ...validBundle, version: 99 };
    const result = validateBundle(bundle);
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.message).toMatch(/expected version 2, got 99/);
  });

  it('rejects v1-style entries with flat data and no versions array', () => {
    const bundle = {
      ...validBundle,
      entries: [
        {
          id: null,
          contentTypeId: null,
          contentTypeIdentifier: 'BlogPost',
          entryTitle: 'Hello',
          entryKey: 'hello',
          slug: null,
          status: 'PUBLISHED',
          publishedAt: null,
          data: { title: 'Hello' },
        },
      ],
    };
    const result = validateBundle(bundle);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some(
        (e) => e.path === 'entries[0]' && /versions/.test(e.message)
      )
    ).toBe(true);
  });

  it('accepts v2-style entries with a non-empty versions array', () => {
    const bundle = {
      ...validBundle,
      entries: [
        {
          id: null,
          contentTypeId: null,
          contentTypeIdentifier: 'BlogPost',
          entryTitle: 'Hello',
          entryKey: 'hello',
          slug: null,
          versions: [
            {
              status: 'PUBLISHED',
              data: { title: 'Hello' },
              publishedAt: null,
            },
          ],
        },
      ],
    };
    const result = validateBundle(bundle);
    expect(result).toEqual({ ok: true, errors: [] });
  });
});

describe('validateBundle two-slot invariant', () => {
  function bundleWithVersions(versions: Array<{ status: ContentStatusName }>) {
    return {
      version: BUNDLE_VERSION,
      exportedAt: '2026-05-30T00:00:00.000Z',
      portable: false,
      entries: [
        {
          id: null,
          contentTypeId: null,
          contentTypeIdentifier: 'Page',
          entryTitle: 'Hello',
          entryKey: 'hello',
          slug: null,
          versions: versions.map((v) => ({
            status: v.status,
            data: {},
            publishedAt: null,
          })),
        },
      ],
    };
  }

  it('rejects two PUBLISHED versions on one entry', () => {
    const result = validateBundle(
      bundleWithVersions([
        { status: CONTENT_STATUSES.PUBLISHED },
        { status: CONTENT_STATUSES.PUBLISHED },
      ])
    );
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => /at most one PUBLISHED/i.test(e.message))
    ).toBe(true);
  });

  it('rejects two draft-slot versions on one entry', () => {
    const result = validateBundle(
      bundleWithVersions([
        { status: CONTENT_STATUSES.DRAFT },
        { status: CONTENT_STATUSES.CHANGED },
      ])
    );
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => /at most one draft/i.test(e.message))
    ).toBe(true);
  });

  it('accepts one PUBLISHED + one DRAFT', () => {
    const result = validateBundle(
      bundleWithVersions([
        { status: CONTENT_STATUSES.PUBLISHED },
        { status: CONTENT_STATUSES.DRAFT },
      ])
    );
    expect(result.ok).toBe(true);
  });

  it('accepts unlimited ARCHIVED versions', () => {
    const result = validateBundle(
      bundleWithVersions([
        { status: CONTENT_STATUSES.PUBLISHED },
        { status: CONTENT_STATUSES.ARCHIVED },
        { status: CONTENT_STATUSES.ARCHIVED },
        { status: CONTENT_STATUSES.ARCHIVED },
      ])
    );
    expect(result.ok).toBe(true);
  });
});
