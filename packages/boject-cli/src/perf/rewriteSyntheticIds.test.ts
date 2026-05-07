import { describe, expect, it } from 'vitest';
import { rewriteSyntheticIds } from './rewriteSyntheticIds.js';

describe('rewriteSyntheticIds', () => {
  it('rewrites a single RELATION ref', () => {
    const data = {
      author: {
        entryId: 'syn-1',
        contentTypeId: 'ct',
        contentTypeIdentifier: 'X',
      },
    };
    const map = new Map([['syn-1', 'real-1']]);
    const out = rewriteSyntheticIds(data, map);
    expect((out as { author: { entryId: string } }).author.entryId).toBe(
      'real-1'
    );
  });

  it('rewrites MULTIRELATION array refs', () => {
    const data = {
      tags: [
        { entryId: 'syn-1', contentTypeId: 'ct', contentTypeIdentifier: 'X' },
        { entryId: 'syn-2', contentTypeId: 'ct', contentTypeIdentifier: 'X' },
      ],
    };
    const map = new Map([
      ['syn-1', 'real-1'],
      ['syn-2', 'real-2'],
    ]);
    const out = rewriteSyntheticIds(data, map) as {
      tags: Array<{ entryId: string }>;
    };
    expect(out.tags[0]!.entryId).toBe('real-1');
    expect(out.tags[1]!.entryId).toBe('real-2');
  });

  it('rewrites cmsEmbed and cmsLink refs inside RICHTEXT body', () => {
    const data = {
      body: {
        type: 'doc',
        content: [
          {
            type: 'cmsEmbed',
            attrs: { entryId: 'syn-1', contentTypeId: 'ct' },
          },
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'hello',
                marks: [
                  {
                    type: 'cmsLink',
                    attrs: { entryId: 'syn-2', contentTypeId: 'ct' },
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const map = new Map([
      ['syn-1', 'real-1'],
      ['syn-2', 'real-2'],
    ]);
    const out = rewriteSyntheticIds(data, map) as {
      body: {
        content: Array<{
          attrs?: { entryId: string };
          content?: Array<{
            marks?: Array<{ attrs: { entryId: string } }>;
          }>;
        }>;
      };
    };
    expect(out.body.content[0]!.attrs!.entryId).toBe('real-1');
    expect(out.body.content[1]!.content![0]!.marks![0]!.attrs.entryId).toBe(
      'real-2'
    );
  });

  it('leaves unmapped synthetic IDs untouched', () => {
    const data = {
      author: {
        entryId: 'syn-unmapped',
        contentTypeId: 'ct',
        contentTypeIdentifier: 'X',
      },
    };
    const map = new Map([['syn-1', 'real-1']]);
    const out = rewriteSyntheticIds(data, map) as {
      author: { entryId: string };
    };
    expect(out.author.entryId).toBe('syn-unmapped');
  });

  it('does not mutate the input', () => {
    const data = {
      author: {
        entryId: 'syn-1',
        contentTypeId: 'ct',
        contentTypeIdentifier: 'X',
      },
    };
    const map = new Map([['syn-1', 'real-1']]);
    rewriteSyntheticIds(data, map);
    expect(data.author.entryId).toBe('syn-1');
  });
});
