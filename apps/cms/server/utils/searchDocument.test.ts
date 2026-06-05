import { describe, it, expect } from 'vitest';
import {
  toSearchDocument,
  richtextToPlainText,
  type SearchableEntry,
  type SearchableFieldDef,
} from './searchDocument';
import { FIELD_TYPES } from '../../utils/fieldTypes';

function entry(overrides: Partial<SearchableEntry> = {}): SearchableEntry {
  return {
    id: 'entry-1',
    entryKey: 'my-article',
    contentType: 'Article',
    entryTitle: 'My Article',
    publishedAt: '2026-05-01T00:00:00.000Z',
    data: {},
    ...overrides,
  };
}

describe('richtextToPlainText', () => {
  it('returns empty string for null / undefined / non-object input', () => {
    expect(richtextToPlainText(null)).toBe('');
    expect(richtextToPlainText(undefined)).toBe('');
    expect(richtextToPlainText('a string')).toBe('');
    expect(richtextToPlainText(42)).toBe('');
  });

  it('returns empty string for an empty doc', () => {
    expect(richtextToPlainText({ type: 'doc', content: [] })).toBe('');
  });

  it('extracts text from a simple paragraph', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
      ],
    };
    expect(richtextToPlainText(doc)).toBe('Hello world');
  });

  it('separates adjacent blocks with a single space', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body text' }] },
      ],
    };
    expect(richtextToPlainText(doc)).toBe('Title Body text');
  });

  it('keeps mark-wrapped text (cmsLink, bold) but drops the mark structure', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'see ' },
            {
              type: 'text',
              text: 'this article',
              marks: [
                {
                  type: 'cmsLink',
                  attrs: { contentTypeId: 'ct', entryId: 'e1' },
                },
              ],
            },
            { type: 'text', text: ' now', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    };
    expect(richtextToPlainText(doc)).toBe('see this article now');
  });

  it('strips cmsEmbed atom nodes (no text content)', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'before ' },
            { type: 'cmsEmbed', attrs: { contentTypeId: 'ct', entryId: 'e1' } },
            { type: 'text', text: ' after' },
          ],
        },
      ],
    };
    expect(richtextToPlainText(doc)).toBe('before after');
  });

  it('flattens table cells separated by spaces', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'A1' }],
                    },
                  ],
                },
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'B1' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(richtextToPlainText(doc)).toBe('A1 B1');
  });

  it('handles deeply nested lists', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
                {
                  type: 'bulletList',
                  content: [
                    {
                      type: 'listItem',
                      content: [
                        {
                          type: 'paragraph',
                          content: [{ type: 'text', text: 'two' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(richtextToPlainText(doc)).toBe('one two');
  });
});

describe('toSearchDocument', () => {
  it('includes the envelope fields with the entry id as document id', () => {
    expect(toSearchDocument(entry(), [])).toEqual({
      id: 'entry-1',
      entryKey: 'my-article',
      contentType: 'Article',
      entryTitle: 'My Article',
      publishedAt: '2026-05-01T00:00:00.000Z',
      fields: {},
    });
  });

  it('passes a null publishedAt through', () => {
    expect(
      toSearchDocument(entry({ publishedAt: null }), []).publishedAt
    ).toBeNull();
  });

  it('maps TEXT / TEXTAREA / SLUG / SELECT as strings under fields', () => {
    const fields: SearchableFieldDef[] = [
      { identifier: 'summary', type: FIELD_TYPES.TEXT },
      { identifier: 'body', type: FIELD_TYPES.TEXTAREA },
      { identifier: 'slug', type: FIELD_TYPES.SLUG },
      { identifier: 'category', type: FIELD_TYPES.SELECT },
    ];
    const doc = toSearchDocument(
      entry({
        data: {
          summary: 'A summary',
          body: 'Long body',
          slug: 'a-slug',
          category: 'news',
        },
      }),
      fields
    );
    expect(doc.fields).toEqual({
      summary: 'A summary',
      body: 'Long body',
      slug: 'a-slug',
      category: 'news',
    });
  });

  it('maps NUMBER, BOOLEAN, DATETIME', () => {
    const fields: SearchableFieldDef[] = [
      { identifier: 'views', type: FIELD_TYPES.NUMBER },
      { identifier: 'featured', type: FIELD_TYPES.BOOLEAN },
      { identifier: 'publishDate', type: FIELD_TYPES.DATETIME },
    ];
    const doc = toSearchDocument(
      entry({
        data: {
          views: 42,
          featured: true,
          publishDate: '2026-01-02T03:04:05.000Z',
        },
      }),
      fields
    );
    expect(doc.fields).toEqual({
      views: 42,
      featured: true,
      publishDate: '2026-01-02T03:04:05.000Z',
    });
  });

  it('flattens RICHTEXT to plain text', () => {
    const fields: SearchableFieldDef[] = [
      { identifier: 'content', type: FIELD_TYPES.RICHTEXT },
    ];
    const doc = toSearchDocument(
      entry({
        data: {
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Rich body' }],
              },
            ],
          },
        },
      }),
      fields
    );
    expect(doc.fields.content).toBe('Rich body');
  });

  it('maps RELATION to the target entryId and MULTIRELATION to an array of entryIds', () => {
    const fields: SearchableFieldDef[] = [
      { identifier: 'author', type: FIELD_TYPES.RELATION },
      { identifier: 'tags', type: FIELD_TYPES.MULTIRELATION },
    ];
    const doc = toSearchDocument(
      entry({
        data: {
          author: { contentTypeId: 'ct-author', entryId: 'author-1' },
          tags: [
            { contentTypeId: 'ct-tag', entryId: 'tag-1' },
            { contentTypeId: 'ct-tag', entryId: 'tag-2' },
          ],
        },
      }),
      fields
    );
    expect(doc.fields.author).toBe('author-1');
    expect(doc.fields.tags).toEqual(['tag-1', 'tag-2']);
  });

  it('skips IMAGE and ENTRY_TITLE fields (no fields keys for them)', () => {
    const fields: SearchableFieldDef[] = [
      { identifier: 'title', type: FIELD_TYPES.ENTRY_TITLE },
      { identifier: 'hero', type: FIELD_TYPES.IMAGE },
      { identifier: 'summary', type: FIELD_TYPES.TEXT },
    ];
    const doc = toSearchDocument(
      entry({
        data: {
          title: 'My Article',
          hero: {
            storageKey: 'k',
            mimeType: 'image/png',
            width: 1,
            height: 1,
            fileSize: 1,
          },
          summary: 'kept',
        },
      }),
      fields
    );
    expect(doc.fields).toEqual({ summary: 'kept' });
    expect(doc.fields).not.toHaveProperty('title');
    expect(doc.fields).not.toHaveProperty('hero');
  });

  describe('edge cases', () => {
    it('degrades missing scalar values to null', () => {
      const fields: SearchableFieldDef[] = [
        { identifier: 'summary', type: FIELD_TYPES.TEXT },
        { identifier: 'views', type: FIELD_TYPES.NUMBER },
        { identifier: 'featured', type: FIELD_TYPES.BOOLEAN },
      ];
      expect(toSearchDocument(entry({ data: {} }), fields).fields).toEqual({
        summary: null,
        views: null,
        featured: null,
      });
    });

    it('degrades a malformed (non-object) data blob to default field values', () => {
      const fields: SearchableFieldDef[] = [
        { identifier: 'summary', type: FIELD_TYPES.TEXT },
      ];
      expect(
        toSearchDocument(entry({ data: 'not an object' }), fields).fields
      ).toEqual({ summary: null });
    });

    it('degrades a null relation to null and a missing multirelation to []', () => {
      const fields: SearchableFieldDef[] = [
        { identifier: 'author', type: FIELD_TYPES.RELATION },
        { identifier: 'tags', type: FIELD_TYPES.MULTIRELATION },
      ];
      const doc = toSearchDocument(entry({ data: { author: null } }), fields);
      expect(doc.fields.author).toBeNull();
      expect(doc.fields.tags).toEqual([]);
    });

    it('drops malformed entries from a MULTIRELATION array', () => {
      const fields: SearchableFieldDef[] = [
        { identifier: 'tags', type: FIELD_TYPES.MULTIRELATION },
      ];
      const doc = toSearchDocument(
        entry({
          data: {
            tags: [
              { contentTypeId: 'ct', entryId: 'tag-1' },
              { contentTypeId: 'ct' },
              { entryId: '' },
              'garbage',
            ],
          },
        }),
        fields
      );
      expect(doc.fields.tags).toEqual(['tag-1']);
    });

    it('flattens an empty richtext value to an empty string', () => {
      const fields: SearchableFieldDef[] = [
        { identifier: 'content', type: FIELD_TYPES.RICHTEXT },
      ];
      expect(toSearchDocument(entry({ data: {} }), fields).fields.content).toBe(
        ''
      );
    });
  });

  it('produces a JSON-serialisable document', () => {
    const fields: SearchableFieldDef[] = [
      { identifier: 'summary', type: FIELD_TYPES.TEXT },
      { identifier: 'tags', type: FIELD_TYPES.MULTIRELATION },
    ];
    const doc = toSearchDocument(
      entry({
        data: { summary: 's', tags: [{ contentTypeId: 'ct', entryId: 't1' }] },
      }),
      fields
    );
    expect(() => JSON.stringify(doc)).not.toThrow();
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });
});
