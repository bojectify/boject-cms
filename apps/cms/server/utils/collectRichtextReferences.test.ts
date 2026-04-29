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
const cmsLinkNode = (contentTypeId: string, entryId: string) => ({
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

  it('collects a single cmsLink node reference', () => {
    expect(
      collectRichtextReferences(
        doc([
          para([text('Before '), cmsLinkNode('ct-2', 'e-2'), text(' after')]),
        ])
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
        para([text('also '), cmsLinkNode('ct-1', 'e-1')]),
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
        bulletList([[para([text('linked '), cmsLinkNode('ct-2', 'e-2')])]]),
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
          text('see also '),
          cmsLinkNode('ct-2', 'e-2'),
        ]),
      ])
    );
    expect(refs).toEqual([
      { contentTypeId: 'ct-1', entryId: 'e-1' },
      { contentTypeId: 'ct-2', entryId: 'e-2' },
    ]);
  });

  it('skips cmsEmbed / cmsLink nodes with missing or non-string ids', () => {
    const refs = collectRichtextReferences(
      doc([
        para([
          { type: 'cmsEmbed', attrs: { contentTypeId: 'ct-1' } }, // no entryId
          { type: 'cmsEmbed', attrs: {} },
          { type: 'cmsLink', attrs: { entryId: 'e-9' } },
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

  it('finds cmsLink node alongside text with other marks in the same paragraph', () => {
    const bold = { type: 'bold' };
    const italic = { type: 'italic' };
    const refs = collectRichtextReferences(
      doc([para([text('mixed', [bold, italic]), cmsLinkNode('ct-1', 'e-1')])])
    );
    expect(refs).toEqual([{ contentTypeId: 'ct-1', entryId: 'e-1' }]);
  });

  it('preserves document-traversal order across embeds and link nodes', () => {
    const refs = collectRichtextReferences(
      doc([
        para([embed('ct-1', 'e-first')]),
        para([text('then '), cmsLinkNode('ct-2', 'e-second')]),
        para([embed('ct-3', 'e-third')]),
      ])
    );
    expect(refs).toEqual([
      { contentTypeId: 'ct-1', entryId: 'e-first' },
      { contentTypeId: 'ct-2', entryId: 'e-second' },
      { contentTypeId: 'ct-3', entryId: 'e-third' },
    ]);
  });

  it('ignores externalLink nodes (no contentTypeId)', () => {
    const externalLinkNode = (href: string) => ({
      type: 'externalLink',
      attrs: { href },
    });
    expect(
      collectRichtextReferences(
        doc([
          para([
            text('See '),
            externalLinkNode('https://example.com'),
            text(' for details'),
          ]),
        ])
      )
    ).toEqual([]);
  });

  it('ignores cmsLink nodes with empty / missing ids (defensive)', () => {
    expect(
      collectRichtextReferences(
        doc([
          para([
            { type: 'cmsLink', attrs: { contentTypeId: '', entryId: 'e-1' } },
            { type: 'cmsLink', attrs: { entryId: 'e-2' } },
          ]),
        ])
      )
    ).toEqual([]);
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
