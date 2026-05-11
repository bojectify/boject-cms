import { describe, expect, it } from 'vitest';
import {
  findUnresolvedRefs,
  rewriteSyntheticIds,
} from './rewriteSyntheticIds.js';

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

describe('findUnresolvedRefs', () => {
  it('returns empty Set for null / undefined / primitives / empty containers', () => {
    const map = new Map<string, string>();
    expect(findUnresolvedRefs(null, map)).toEqual(new Set());
    expect(findUnresolvedRefs(undefined, map)).toEqual(new Set());
    expect(findUnresolvedRefs('hello', map)).toEqual(new Set());
    expect(findUnresolvedRefs(42, map)).toEqual(new Set());
    expect(findUnresolvedRefs(true, map)).toEqual(new Set());
    expect(findUnresolvedRefs({}, map)).toEqual(new Set());
    expect(findUnresolvedRefs([], map)).toEqual(new Set());
  });

  it('returns empty Set when a single RELATION ref is mapped', () => {
    const data = {
      author: {
        entryId: 'syn-1',
        contentTypeId: 'X',
        contentTypeIdentifier: 'Author',
      },
    };
    const map = new Map([['syn-1', 'real-1']]);
    expect(findUnresolvedRefs(data, map)).toEqual(new Set());
  });

  it('collects a single unmapped RELATION ref', () => {
    const data = {
      author: {
        entryId: 'syn-1',
        contentTypeId: 'X',
        contentTypeIdentifier: 'Author',
      },
    };
    const map = new Map<string, string>();
    expect(findUnresolvedRefs(data, map)).toEqual(new Set(['syn-1']));
  });

  it('collects only the unmapped entry from a MULTIRELATION array', () => {
    const data = {
      authors: [
        { entryId: 'a', contentTypeId: 'X' },
        { entryId: 'b', contentTypeId: 'X' },
      ],
    };
    const map = new Map([['a', 'real-a']]);
    expect(findUnresolvedRefs(data, map)).toEqual(new Set(['b']));
  });

  it('collects an unmapped cmsEmbed entryId inside a RICHTEXT body', () => {
    const data = {
      body: {
        type: 'doc',
        content: [
          {
            type: 'cmsEmbed',
            attrs: { entryId: 'syn-X', contentTypeId: 'CT' },
          },
        ],
      },
    };
    const map = new Map<string, string>();
    expect(findUnresolvedRefs(data, map)).toEqual(new Set(['syn-X']));
  });

  it('collects an unmapped cmsLink entryId on a text node mark', () => {
    const data = {
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'hello',
                marks: [
                  {
                    type: 'cmsLink',
                    attrs: { entryId: 'syn-Y', contentTypeId: 'CT' },
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const map = new Map<string, string>();
    expect(findUnresolvedRefs(data, map)).toEqual(new Set(['syn-Y']));
  });

  it('recurses into nested ProseMirror content arrays', () => {
    const data = {
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'deep',
                    marks: [
                      {
                        type: 'cmsLink',
                        attrs: { entryId: 'syn-deep', contentTypeId: 'CT' },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const map = new Map<string, string>();
    expect(findUnresolvedRefs(data, map)).toEqual(new Set(['syn-deep']));
  });

  it('returns the union of unmapped IDs across mixed shapes in one entry', () => {
    const data = {
      author: {
        entryId: 'syn-mapped',
        contentTypeId: 'X',
        contentTypeIdentifier: 'Author',
      },
      tags: [
        { entryId: 'syn-tag-a', contentTypeId: 'T' },
        { entryId: 'syn-tag-b', contentTypeId: 'T' },
      ],
      body: {
        type: 'doc',
        content: [
          {
            type: 'cmsEmbed',
            attrs: { entryId: 'syn-embed', contentTypeId: 'CT' },
          },
        ],
      },
    };
    const map = new Map([
      ['syn-mapped', 'real-mapped'],
      ['syn-tag-a', 'real-tag-a'],
    ]);
    expect(findUnresolvedRefs(data, map)).toEqual(
      new Set(['syn-tag-b', 'syn-embed'])
    );
  });
});
