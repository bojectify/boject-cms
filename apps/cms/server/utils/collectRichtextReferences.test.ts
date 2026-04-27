import { describe, it, expect } from 'vitest';
import { collectRichtextReferences } from './collectRichtextReferences';

const doc = (content: unknown[]) => ({ type: 'doc', content });
const para = (content: unknown[]) => ({ type: 'paragraph', content });
const text = (value: string, marks?: unknown[]) =>
  marks ? { type: 'text', text: value, marks } : { type: 'text', text: value };
const embed = (contentTypeId: string, entryId: string) => ({
  type: 'cmsEmbed',
  attrs: { contentTypeId, entryId },
});
const cmsLinkMark = (contentTypeId: string, entryId: string) => ({
  type: 'cmsLink',
  attrs: { contentTypeId, entryId },
});
const externalLinkMark = (href: string) => ({ type: 'link', attrs: { href } });
const blockquote = (content: unknown[]) => ({ type: 'blockquote', content });
const bulletList = (items: unknown[][]) => ({
  type: 'bulletList',
  content: items.map((c) => ({ type: 'listItem', content: c })),
});

describe('collectRichtextReferences', () => {
  it('returns empty array for body with no references', () => {
    expect(collectRichtextReferences(doc([para([text('plain')])]))).toEqual([]);
  });

  it('handles null / undefined / non-object input', () => {
    expect(collectRichtextReferences(null)).toEqual([]);
    expect(collectRichtextReferences(undefined)).toEqual([]);
    expect(collectRichtextReferences('string')).toEqual([]);
  });

  it('collects a single cmsEmbed reference', () => {
    expect(
      collectRichtextReferences(doc([para([embed('ct-1', 'e-1')])]))
    ).toEqual([{ contentTypeId: 'ct-1', entryId: 'e-1' }]);
  });

  it('collects a single cmsLink mark reference', () => {
    expect(
      collectRichtextReferences(
        doc([para([text('Click', [cmsLinkMark('ct-2', 'e-2')])])])
      )
    ).toEqual([{ contentTypeId: 'ct-2', entryId: 'e-2' }]);
  });

  it('ignores external link marks', () => {
    expect(
      collectRichtextReferences(
        doc([para([text('Click', [externalLinkMark('https://x.test')])])])
      )
    ).toEqual([]);
  });

  it('deduplicates the same (contentTypeId, entryId) appearing multiple times', () => {
    const refs = collectRichtextReferences(
      doc([
        para([embed('ct-1', 'e-1'), embed('ct-1', 'e-1')]),
        para([text('also', [cmsLinkMark('ct-1', 'e-1')])]),
      ])
    );
    expect(refs).toEqual([{ contentTypeId: 'ct-1', entryId: 'e-1' }]);
  });

  it('does NOT dedupe across different entryIds with the same contentTypeId', () => {
    const refs = collectRichtextReferences(
      doc([para([embed('ct-1', 'e-1'), embed('ct-1', 'e-2')])])
    );
    expect(refs).toEqual([
      { contentTypeId: 'ct-1', entryId: 'e-1' },
      { contentTypeId: 'ct-1', entryId: 'e-2' },
    ]);
  });

  it('finds references nested inside blockquote and lists', () => {
    const refs = collectRichtextReferences(
      doc([
        blockquote([para([embed('ct-1', 'e-1')])]),
        bulletList([[para([text('linked', [cmsLinkMark('ct-2', 'e-2')])])]]),
      ])
    );
    expect(refs).toEqual([
      { contentTypeId: 'ct-1', entryId: 'e-1' },
      { contentTypeId: 'ct-2', entryId: 'e-2' },
    ]);
  });

  it('combines cmsEmbed + cmsLink references in one body', () => {
    const refs = collectRichtextReferences(
      doc([
        para([
          embed('ct-1', 'e-1'),
          text('see also', [cmsLinkMark('ct-2', 'e-2')]),
        ]),
      ])
    );
    expect(refs).toEqual([
      { contentTypeId: 'ct-1', entryId: 'e-1' },
      { contentTypeId: 'ct-2', entryId: 'e-2' },
    ]);
  });

  it('skips cmsEmbed nodes / cmsLink marks with missing or non-string ids', () => {
    const refs = collectRichtextReferences(
      doc([
        para([
          { type: 'cmsEmbed', attrs: { contentTypeId: 'ct-1' } }, // no entryId
          { type: 'cmsEmbed', attrs: {} },
          text('x', [{ type: 'cmsLink', attrs: { entryId: 'e-9' } }]),
        ]),
      ])
    );
    expect(refs).toEqual([]);
  });

  it('skips cmsEmbed nodes whose ids are non-string types', () => {
    const refs = collectRichtextReferences(
      doc([
        para([
          { type: 'cmsEmbed', attrs: { contentTypeId: 123, entryId: 'e-1' } },
          { type: 'cmsEmbed', attrs: { contentTypeId: 'ct-1', entryId: null } },
          { type: 'cmsEmbed', attrs: { contentTypeId: {}, entryId: [] } },
        ]),
      ])
    );
    expect(refs).toEqual([]);
  });

  it('skips cmsEmbed nodes with empty-string ids', () => {
    const refs = collectRichtextReferences(
      doc([
        para([
          { type: 'cmsEmbed', attrs: { contentTypeId: '', entryId: 'e-1' } },
          { type: 'cmsEmbed', attrs: { contentTypeId: 'ct-1', entryId: '' } },
        ]),
      ])
    );
    expect(refs).toEqual([]);
  });

  it('finds cmsLink alongside other marks on the same text node', () => {
    const bold = { type: 'bold' };
    const italic = { type: 'italic' };
    const refs = collectRichtextReferences(
      doc([para([text('mixed', [bold, cmsLinkMark('ct-1', 'e-1'), italic])])])
    );
    expect(refs).toEqual([{ contentTypeId: 'ct-1', entryId: 'e-1' }]);
  });

  it('does NOT collect cmsLink marks attached to non-text nodes', () => {
    // A buggy / hand-crafted payload attaches a cmsLink mark to a paragraph
    const refs = collectRichtextReferences(
      doc([
        {
          type: 'paragraph',
          marks: [
            {
              type: 'cmsLink',
              attrs: { contentTypeId: 'ct-1', entryId: 'e-1' },
            },
          ],
          content: [text('plain')],
        },
      ])
    );
    expect(refs).toEqual([]);
  });

  it('preserves document-traversal order across embeds and link marks', () => {
    const refs = collectRichtextReferences(
      doc([
        para([embed('ct-1', 'e-first')]),
        para([text('then', [cmsLinkMark('ct-2', 'e-second')])]),
        para([embed('ct-3', 'e-third')]),
      ])
    );
    expect(refs).toEqual([
      { contentTypeId: 'ct-1', entryId: 'e-first' },
      { contentTypeId: 'ct-2', entryId: 'e-second' },
      { contentTypeId: 'ct-3', entryId: 'e-third' },
    ]);
  });

  it('caps recursion depth and silently drops deeper references', () => {
    // Build a deeply nested doc whose innermost paragraph contains an embed.
    // Wrap the embed paragraph in 1100 nested blockquotes so it sits below
    // the MAX_DEPTH cap of 1000.
    let inner: unknown = {
      type: 'paragraph',
      content: [
        {
          type: 'cmsEmbed',
          attrs: { contentTypeId: 'ct-deep', entryId: 'e-deep' },
        },
      ],
    };
    for (let i = 0; i < 1100; i++) {
      inner = { type: 'blockquote', content: [inner] };
    }
    const body = doc([inner]);
    const refs = collectRichtextReferences(body);
    expect(refs).toEqual([]);
  });
});
