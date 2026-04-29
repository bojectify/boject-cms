import { describe, it, expect, vi } from 'vitest';
import {
  collectEmbedContentTypeIds,
  enrichBodyWithContentTypeIdentifiers,
  enrichEntryDataWithEmbedIdentifiers,
} from './enrichRichtextEmbeds';

// ---------------------------------------------------------------------------
// Test factories (mirrored from validateEntryData.test.ts)
// ---------------------------------------------------------------------------

const doc = (content: unknown[]) => ({ type: 'doc', content });
const para = (content: unknown[]) => ({ type: 'paragraph', content });
const text = (value: string) => ({ type: 'text', text: value });
const embed = (
  contentTypeId: string,
  entryId: string,
  extra?: Record<string, unknown>
) => ({
  type: 'cmsEmbed',
  attrs: { contentTypeId, entryId, ...extra },
});
const blockquote = (content: unknown[]) => ({ type: 'blockquote', content });
const bulletList = (items: unknown[][]) => ({
  type: 'bulletList',
  content: items.map((content) => ({ type: 'listItem', content })),
});
const tableRow = (cells: unknown[]) => ({ type: 'tableRow', content: cells });
const tableCell = (content: unknown[]) => ({ type: 'tableCell', content });
const table = (rows: unknown[]) => ({ type: 'table', content: rows });

// ---------------------------------------------------------------------------
// collectEmbedContentTypeIds
// ---------------------------------------------------------------------------

describe('collectEmbedContentTypeIds', () => {
  it('returns empty set for doc with no embeds', () => {
    const result = collectEmbedContentTypeIds(doc([para([text('hello')])]));
    expect(result.size).toBe(0);
  });

  it('collects id from a single top-level embed', () => {
    const result = collectEmbedContentTypeIds(
      doc([para([embed('ct-1', 'e-1')])])
    );
    expect(result).toEqual(new Set(['ct-1']));
  });

  it('deduplicates repeated contentTypeIds', () => {
    const result = collectEmbedContentTypeIds(
      doc([
        para([embed('ct-1', 'e-1'), embed('ct-1', 'e-2')]),
        para([embed('ct-1', 'e-3')]),
      ])
    );
    expect(result).toEqual(new Set(['ct-1']));
  });

  it('collects multiple distinct contentTypeIds', () => {
    const result = collectEmbedContentTypeIds(
      doc([para([embed('ct-1', 'e-1'), embed('ct-2', 'e-2')])])
    );
    expect(result).toEqual(new Set(['ct-1', 'ct-2']));
  });

  it('handles null / undefined gracefully', () => {
    expect(collectEmbedContentTypeIds(null).size).toBe(0);
    expect(collectEmbedContentTypeIds(undefined).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// enrichBodyWithContentTypeIdentifiers
// ---------------------------------------------------------------------------

describe('enrichBodyWithContentTypeIdentifiers', () => {
  const map = new Map([
    ['ct-1', 'Author'],
    ['ct-2', 'Article'],
  ]);

  it('returns structurally equal object when doc has no embeds', () => {
    const input = doc([para([text('hello')])]);
    const snapshot = JSON.parse(JSON.stringify(input));
    const result = enrichBodyWithContentTypeIdentifiers(input, map);
    expect(result).toEqual(snapshot);
  });

  it('does not mutate the input', () => {
    const input = doc([para([embed('ct-1', 'e-1')])]);
    const snapshot = JSON.parse(JSON.stringify(input));
    enrichBodyWithContentTypeIdentifiers(input, map);
    expect(input).toEqual(snapshot);
  });

  it('stamps identifier on a single embed at top level', () => {
    const input = doc([para([embed('ct-1', 'e-1')])]);
    const result = enrichBodyWithContentTypeIdentifiers(input, map) as {
      content: { content: { attrs: Record<string, unknown> }[] }[];
    };
    expect(result.content[0]!.content[0]!.attrs).toEqual({
      contentTypeId: 'ct-1',
      entryId: 'e-1',
      contentTypeIdentifier: 'Author',
    });
  });

  it('stamps identifier on an embed nested in blockquote', () => {
    const input = doc([blockquote([para([embed('ct-2', 'e-2')])])]);
    const result = enrichBodyWithContentTypeIdentifiers(input, map) as {
      content: {
        content: { content: { attrs: Record<string, unknown> }[] }[];
      }[];
    };
    expect(result.content[0]!.content[0]!.content[0]!.attrs).toEqual({
      contentTypeId: 'ct-2',
      entryId: 'e-2',
      contentTypeIdentifier: 'Article',
    });
  });

  it('stamps identifier on an embed nested in a list', () => {
    const input = doc([bulletList([[para([embed('ct-1', 'e-1')])]])]);
    const result = enrichBodyWithContentTypeIdentifiers(input, map) as {
      content: {
        content: {
          content: { content: { attrs: Record<string, unknown> }[] }[];
        }[];
      }[];
    };
    // bulletList > listItem > para > embed
    const embedNode = result.content[0]!.content[0]!.content[0]!.content[0]!;
    expect(embedNode.attrs).toEqual({
      contentTypeId: 'ct-1',
      entryId: 'e-1',
      contentTypeIdentifier: 'Author',
    });
  });

  it('stamps identifier on an embed nested in a table cell', () => {
    const input = doc([
      table([tableRow([tableCell([para([embed('ct-2', 'e-3')])])])]),
    ]);
    const result = enrichBodyWithContentTypeIdentifiers(input, map) as {
      content: {
        content: {
          content: {
            content: {
              content: { attrs: Record<string, unknown> }[];
            }[];
          }[];
        }[];
      }[];
    };
    const embedNode =
      result.content[0]!.content[0]!.content[0]!.content[0]!.content[0]!;
    expect(embedNode.attrs).toEqual({
      contentTypeId: 'ct-2',
      entryId: 'e-3',
      contentTypeIdentifier: 'Article',
    });
  });

  it('stamps correct identifier on multiple embeds of different content types', () => {
    const input = doc([para([embed('ct-1', 'e-1'), embed('ct-2', 'e-2')])]);
    const result = enrichBodyWithContentTypeIdentifiers(input, map) as {
      content: { content: { attrs: Record<string, unknown> }[] }[];
    };
    expect(result.content[0]!.content[0]!.attrs.contentTypeIdentifier).toBe(
      'Author'
    );
    expect(result.content[0]!.content[1]!.attrs.contentTypeIdentifier).toBe(
      'Article'
    );
  });

  it('leaves attrs alone when contentTypeId is not in the map (deleted content type)', () => {
    const input = doc([para([embed('ct-unknown', 'e-1')])]);
    const result = enrichBodyWithContentTypeIdentifiers(input, map) as {
      content: { content: { attrs: Record<string, unknown> }[] }[];
    };
    expect(result.content[0]!.content[0]!.attrs).toEqual({
      contentTypeId: 'ct-unknown',
      entryId: 'e-1',
    });
    expect(
      'contentTypeIdentifier' in result.content[0]!.content[0]!.attrs
    ).toBe(false);
  });

  it('overwrites stale contentTypeIdentifier with the canonical current value', () => {
    const input = doc([
      para([embed('ct-1', 'e-1', { contentTypeIdentifier: 'OldName' })]),
    ]);
    const result = enrichBodyWithContentTypeIdentifiers(input, map) as {
      content: { content: { attrs: Record<string, unknown> }[] }[];
    };
    expect(result.content[0]!.content[0]!.attrs.contentTypeIdentifier).toBe(
      'Author'
    );
  });
});

// ---------------------------------------------------------------------------
// enrichEntryDataWithEmbedIdentifiers
// ---------------------------------------------------------------------------

describe('enrichEntryDataWithEmbedIdentifiers', () => {
  it('returns original data reference when there are no RICHTEXT fields', async () => {
    const data = { title: 'Hello' };
    const deps = { loadIdentifiers: vi.fn() };
    const result = await enrichEntryDataWithEmbedIdentifiers(
      data,
      [{ identifier: 'title', type: 'ENTRY_TITLE' }],
      deps
    );
    expect(result).toBe(data);
    expect(deps.loadIdentifiers).not.toHaveBeenCalled();
  });

  it('returns original data reference when RICHTEXT field has no embeds', async () => {
    const data = { body: doc([para([text('plain text')])]) };
    const deps = { loadIdentifiers: vi.fn() };
    const result = await enrichEntryDataWithEmbedIdentifiers(
      data,
      [{ identifier: 'body', type: 'RICHTEXT' }],
      deps
    );
    expect(result).toBe(data);
    expect(deps.loadIdentifiers).not.toHaveBeenCalled();
  });

  it('enriches the RICHTEXT field and calls loadIdentifiers once with union of unique IDs', async () => {
    const data = {
      title: 'Host',
      body: doc([para([embed('ct-1', 'e-1')])]),
      summary: doc([para([embed('ct-1', 'e-2'), embed('ct-2', 'e-3')])]),
    };
    const loadIdentifiers = vi.fn().mockResolvedValue(
      new Map([
        ['ct-1', 'Author'],
        ['ct-2', 'Article'],
      ])
    );
    const deps = { loadIdentifiers };

    const result = await enrichEntryDataWithEmbedIdentifiers(
      data,
      [
        { identifier: 'title', type: 'ENTRY_TITLE' },
        { identifier: 'body', type: 'RICHTEXT' },
        { identifier: 'summary', type: 'RICHTEXT' },
      ],
      deps
    );

    // loadIdentifiers called exactly once
    expect(loadIdentifiers).toHaveBeenCalledOnce();
    // Called with the union of unique IDs (order-independent)
    const calledWith: string[] = loadIdentifiers.mock.calls[0]![0] as string[];
    expect(new Set(calledWith)).toEqual(new Set(['ct-1', 'ct-2']));

    // Non-RICHTEXT field unchanged
    expect(result.title).toBe('Host');

    // body embed stamped
    const bodyPara = (result.body as ReturnType<typeof doc>).content[0] as {
      content: { attrs: Record<string, unknown> }[];
    };
    expect(bodyPara.content[0]!.attrs.contentTypeIdentifier).toBe('Author');

    // summary embeds stamped
    const summaryPara = (result.summary as ReturnType<typeof doc>)
      .content[0] as {
      content: { attrs: Record<string, unknown> }[];
    };
    expect(summaryPara.content[0]!.attrs.contentTypeIdentifier).toBe('Author');
    expect(summaryPara.content[1]!.attrs.contentTypeIdentifier).toBe('Article');
  });

  it('does not mutate the input data object', async () => {
    const data = { body: doc([para([embed('ct-1', 'e-1')])]) };
    const snapshot = JSON.parse(JSON.stringify(data));
    await enrichEntryDataWithEmbedIdentifiers(
      data,
      [{ identifier: 'body', type: 'RICHTEXT' }],
      {
        loadIdentifiers: vi
          .fn()
          .mockResolvedValue(new Map([['ct-1', 'Author']])),
      }
    );
    expect(data).toEqual(snapshot);
  });

  it('enriches a RICHTEXT body that contains only cmsLink nodes (no embeds)', async () => {
    const data = {
      body: doc([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'visit ' },
            {
              type: 'cmsLink',
              attrs: { contentTypeId: 'ct-1', entryId: 'e-1' },
            },
          ],
        },
      ]),
    };
    const loadIdentifiers = vi
      .fn()
      .mockResolvedValue(new Map([['ct-1', 'Page']]));

    const result = await enrichEntryDataWithEmbedIdentifiers(
      data,
      [{ identifier: 'body', type: 'RICHTEXT' }],
      { loadIdentifiers }
    );

    expect(loadIdentifiers).toHaveBeenCalledOnce();
    const calledWith = loadIdentifiers.mock.calls[0]![0] as string[];
    expect(new Set(calledWith)).toEqual(new Set(['ct-1']));

    const bodyPara = (result.body as ReturnType<typeof doc>).content[0] as {
      content: { type: string; attrs?: Record<string, unknown> }[];
    };
    const linkNode = bodyPara.content[1]!;
    expect(linkNode.attrs!.contentTypeIdentifier).toBe('Page');
  });
});

// ---------------------------------------------------------------------------
// cmsLink node coverage
// ---------------------------------------------------------------------------

const cmsLink = (
  contentTypeId: string,
  entryId: string,
  extra?: Record<string, unknown>
) => ({
  type: 'cmsLink',
  attrs: { contentTypeId, entryId, ...extra },
});

describe('collectEmbedContentTypeIds — cmsLink nodes', () => {
  it('collects contentTypeId from a cmsLink inline node', () => {
    const result = collectEmbedContentTypeIds(
      doc([para([text('visit '), cmsLink('ct-1', 'e-1')])])
    );
    expect(result).toEqual(new Set(['ct-1']));
  });

  it('ignores externalLink nodes (no contentTypeId)', () => {
    const result = collectEmbedContentTypeIds(
      doc([
        para([
          text('visit '),
          { type: 'externalLink', attrs: { href: 'https://x' } },
        ]),
      ])
    );
    expect(result.size).toBe(0);
  });

  it('combines contentTypeIds from embeds and cmsLink nodes', () => {
    const result = collectEmbedContentTypeIds(
      doc([para([embed('ct-1', 'e-1'), text('and '), cmsLink('ct-2', 'e-2')])])
    );
    expect(result).toEqual(new Set(['ct-1', 'ct-2']));
  });
});

describe('enrichBodyWithContentTypeIdentifiers — cmsLink nodes', () => {
  const map = new Map([
    ['ct-1', 'Author'],
    ['ct-2', 'Page'],
  ]);

  it('stamps identifier on a cmsLink node', () => {
    const input = doc([para([text('visit '), cmsLink('ct-2', 'e-1')])]);
    const result = enrichBodyWithContentTypeIdentifiers(input, map) as {
      content: {
        content: { type: string; attrs?: Record<string, unknown> }[];
      }[];
    };
    const linkNode = result.content[0]!.content[1]!;
    expect(linkNode.attrs).toEqual({
      contentTypeId: 'ct-2',
      entryId: 'e-1',
      contentTypeIdentifier: 'Page',
    });
  });

  it('leaves externalLink nodes content-shape untouched (no contentTypeIdentifier)', () => {
    const input = doc([
      para([
        text('visit '),
        { type: 'externalLink', attrs: { href: 'https://x' } },
      ]),
    ]);
    const result = enrichBodyWithContentTypeIdentifiers(input, map) as {
      content: {
        content: { type: string; attrs?: Record<string, unknown> }[];
      }[];
    };
    const externalNode = result.content[0]!.content[1]!;
    expect(externalNode.type).toBe('externalLink');
    expect(externalNode.attrs).toEqual({ href: 'https://x' });
    expect(
      'contentTypeIdentifier' in (externalNode.attrs as Record<string, unknown>)
    ).toBe(false);
  });

  it('does not mutate the input when stamping a cmsLink node', () => {
    const input = doc([para([text('visit '), cmsLink('ct-1', 'e-1')])]);
    const snapshot = JSON.parse(JSON.stringify(input));
    enrichBodyWithContentTypeIdentifiers(input, map);
    expect(input).toEqual(snapshot);
  });

  it('overwrites stale contentTypeIdentifier on a cmsLink node', () => {
    const input = doc([
      para([
        text('visit '),
        cmsLink('ct-1', 'e-1', { contentTypeIdentifier: 'Old' }),
      ]),
    ]);
    const result = enrichBodyWithContentTypeIdentifiers(input, map) as {
      content: { content: { attrs: Record<string, unknown> }[] }[];
    };
    expect(result.content[0]!.content[1]!.attrs.contentTypeIdentifier).toBe(
      'Author'
    );
  });

  it('leaves cmsLink node attrs alone if contentTypeId is not in the map', () => {
    const input = doc([para([text('visit '), cmsLink('ct-unknown', 'e-1')])]);
    const result = enrichBodyWithContentTypeIdentifiers(input, map) as {
      content: { content: { attrs: Record<string, unknown> }[] }[];
    };
    expect(
      'contentTypeIdentifier' in result.content[0]!.content[1]!.attrs
    ).toBe(false);
  });

  it('stamps contentTypeIdentifier on cmsLink nodes', async () => {
    const body = doc([
      para([
        text('See '),
        {
          type: 'cmsLink',
          attrs: { contentTypeId: 'ct-author', entryId: 'a1' },
        },
        text(' for details'),
      ]),
    ]);
    const enriched = enrichBodyWithContentTypeIdentifiers(
      body,
      new Map([['ct-author', 'Author']])
    );
    const para0 = (enriched as { content: { content: unknown[] }[] })
      .content[0]!;
    const cmsLinkNode = para0.content.find(
      (n: unknown): n is { attrs: Record<string, unknown> } =>
        typeof n === 'object' &&
        n !== null &&
        (n as { type?: string }).type === 'cmsLink'
    )!;
    expect(cmsLinkNode.attrs.contentTypeIdentifier).toBe('Author');
  });

  it('stamps rel="noopener noreferrer" on cmsLink nodes with target="_blank"', () => {
    const body = doc([
      para([
        {
          type: 'cmsLink',
          attrs: {
            contentTypeId: 'ct-author',
            entryId: 'a1',
            target: '_blank',
          },
        },
      ]),
    ]);
    const enriched = enrichBodyWithContentTypeIdentifiers(
      body,
      new Map([['ct-author', 'Author']])
    );
    const para0 = (enriched as { content: { content: unknown[] }[] })
      .content[0]!;
    const cmsLinkNode = para0.content[0] as { attrs: Record<string, unknown> };
    expect(cmsLinkNode.attrs.rel).toBe('noopener noreferrer');
  });

  it('stamps rel="nofollow noopener noreferrer" when target=_blank and rel=nofollow', () => {
    const body = doc([
      para([
        {
          type: 'externalLink',
          attrs: {
            href: 'https://example.com',
            target: '_blank',
            rel: 'nofollow',
          },
        },
      ]),
    ]);
    const enriched = enrichBodyWithContentTypeIdentifiers(body, new Map());
    const para0 = (enriched as { content: { content: unknown[] }[] })
      .content[0]!;
    const node = para0.content[0] as { attrs: Record<string, unknown> };
    expect(node.attrs.rel).toBe('nofollow noopener noreferrer');
  });

  it('does not modify rel when target is not _blank', () => {
    const body = doc([
      para([
        {
          type: 'externalLink',
          attrs: { href: 'https://example.com', rel: 'nofollow' },
        },
      ]),
    ]);
    const enriched = enrichBodyWithContentTypeIdentifiers(body, new Map());
    const para0 = (enriched as { content: { content: unknown[] }[] })
      .content[0]!;
    const node = para0.content[0] as { attrs: Record<string, unknown> };
    expect(node.attrs.rel).toBe('nofollow');
  });
});
