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

// Thin ProseMirror node builders for the richtext walker tests — each maps
// 1:1 to a node type so the structure under test stays legible. Loosely typed
// because richtextToPlainText takes `unknown` and must tolerate any shape.
const pm = {
  doc: (...content: unknown[]) => ({ type: 'doc', content }),
  paragraph: (...content: unknown[]) => ({ type: 'paragraph', content }),
  heading: (...content: unknown[]) => ({ type: 'heading', content }),
  text: (value: string, marks?: unknown[]) =>
    marks
      ? { type: 'text', text: value, marks }
      : { type: 'text', text: value },
  hardBreak: () => ({ type: 'hardBreak' }),
  cmsEmbed: (contentTypeId: string, entryId: string) => ({
    type: 'cmsEmbed',
    attrs: { contentTypeId, entryId },
  }),
  cmsLinkMark: (contentTypeId: string, entryId: string) => ({
    type: 'cmsLink',
    attrs: { contentTypeId, entryId },
  }),
  bulletList: (...content: unknown[]) => ({ type: 'bulletList', content }),
  listItem: (...content: unknown[]) => ({ type: 'listItem', content }),
  table: (...content: unknown[]) => ({ type: 'table', content }),
  tableRow: (...content: unknown[]) => ({ type: 'tableRow', content }),
  tableCell: (...content: unknown[]) => ({ type: 'tableCell', content }),
};

describe('richtextToPlainText', () => {
  it('returns empty string for null / undefined / non-object input', () => {
    expect(richtextToPlainText(null)).toBe('');
    expect(richtextToPlainText(undefined)).toBe('');
    expect(richtextToPlainText('a string')).toBe('');
    expect(richtextToPlainText(42)).toBe('');
  });

  it('returns empty string for an empty doc', () => {
    expect(richtextToPlainText(pm.doc())).toBe('');
  });

  it('extracts text from a simple paragraph', () => {
    expect(
      richtextToPlainText(pm.doc(pm.paragraph(pm.text('Hello world'))))
    ).toBe('Hello world');
  });

  it('separates adjacent blocks with a single space', () => {
    expect(
      richtextToPlainText(
        pm.doc(pm.heading(pm.text('Title')), pm.paragraph(pm.text('Body text')))
      )
    ).toBe('Title Body text');
  });

  it('keeps mark-wrapped text (cmsLink, bold) but drops the mark structure', () => {
    const body = pm.doc(
      pm.paragraph(
        pm.text('see '),
        pm.text('this article', [pm.cmsLinkMark('ct', 'e1')]),
        pm.text(' now', [{ type: 'bold' }])
      )
    );
    expect(richtextToPlainText(body)).toBe('see this article now');
  });

  it('strips cmsEmbed atom nodes (no text content)', () => {
    const body = pm.doc(
      pm.paragraph(
        pm.text('before '),
        pm.cmsEmbed('ct', 'e1'),
        pm.text(' after')
      )
    );
    expect(richtextToPlainText(body)).toBe('before after');
  });

  it('treats a hardBreak as a word boundary (no fusing)', () => {
    const body = pm.doc(
      pm.paragraph(pm.text('line1'), pm.hardBreak(), pm.text('line2'))
    );
    expect(richtextToPlainText(body)).toBe('line1 line2');
  });

  it('flattens table cells separated by spaces', () => {
    const body = pm.doc(
      pm.table(
        pm.tableRow(
          pm.tableCell(pm.paragraph(pm.text('A1'))),
          pm.tableCell(pm.paragraph(pm.text('B1')))
        )
      )
    );
    expect(richtextToPlainText(body)).toBe('A1 B1');
  });

  it('handles deeply nested lists', () => {
    const body = pm.doc(
      pm.bulletList(
        pm.listItem(
          pm.paragraph(pm.text('one')),
          pm.bulletList(pm.listItem(pm.paragraph(pm.text('two'))))
        )
      )
    );
    expect(richtextToPlainText(body)).toBe('one two');
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
          content: pm.doc(pm.paragraph(pm.text('Rich body'))),
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
