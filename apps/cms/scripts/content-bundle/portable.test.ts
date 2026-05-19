import { describe, expect, it } from 'vitest';
import {
  encodeRelationRef,
  decodeRelationRef,
  encodeDataRefs,
  decodeDataRefs,
} from './portable';
import { FIELD_TYPES } from '../../utils/fieldTypes';

const typeIdToIdent = new Map([['aaa-uuid-ct', 'BlogPost']]);
const typeIdentToEntryKeys = new Map([
  ['BlogPost', new Map([['post-uuid-1', 'hello']])],
]);

const identToTypeId = new Map([['BlogPost', 'aaa-uuid-ct']]);
const typeIdentToKeyToEntry = new Map([
  [
    'BlogPost',
    new Map<string, string>([
      ['hello', 'post-uuid-1'],
      ['Hello', 'post-uuid-1'],
    ]),
  ],
]);

describe('encodeRelationRef', () => {
  it('rewrites a UUID ref to identifier + slug', () => {
    const ref = encodeRelationRef(
      { contentTypeId: 'aaa-uuid-ct', entryId: 'post-uuid-1' },
      typeIdToIdent,
      typeIdentToEntryKeys
    );
    expect(ref).toEqual({
      contentTypeIdentifier: 'BlogPost',
      entryKey: 'hello',
    });
  });

  it('throws when the entry has no entryKey registered', () => {
    expect(() =>
      encodeRelationRef(
        { contentTypeId: 'aaa-uuid-ct', entryId: 'post-uuid-1' },
        typeIdToIdent,
        new Map([['BlogPost', new Map()]])
      )
    ).toThrow(/has no entryKey/);
  });

  it('throws when ref cannot be resolved', () => {
    expect(() =>
      encodeRelationRef(
        { contentTypeId: 'missing', entryId: 'missing' },
        typeIdToIdent,
        typeIdentToEntryKeys
      )
    ).toThrow();
  });
});

describe('decodeRelationRef', () => {
  it('resolves identifier + slug back to UUIDs', () => {
    const ref = decodeRelationRef(
      { contentTypeIdentifier: 'BlogPost', entryKey: 'hello' },
      identToTypeId,
      typeIdentToKeyToEntry
    );
    expect(ref).toEqual({
      contentTypeId: 'aaa-uuid-ct',
      entryId: 'post-uuid-1',
    });
  });

  it('throws when identifier or key is not resolvable', () => {
    expect(() =>
      decodeRelationRef(
        { contentTypeIdentifier: 'BlogPost', entryKey: 'ghost' },
        identToTypeId,
        typeIdentToKeyToEntry
      )
    ).toThrow();
  });
});

describe('encodeDataRefs / decodeDataRefs round-trip', () => {
  it('walks and rewrites RELATION values inside data', () => {
    const data = {
      title: 'Post',
      author: { contentTypeId: 'aaa-uuid-ct', entryId: 'post-uuid-1' },
      tags: [{ contentTypeId: 'aaa-uuid-ct', entryId: 'post-uuid-1' }],
    };
    const fieldTypes = {
      title: FIELD_TYPES.ENTRY_TITLE,
      author: FIELD_TYPES.RELATION,
      tags: FIELD_TYPES.MULTIRELATION,
    };

    const encoded = encodeDataRefs(
      data,
      fieldTypes,
      typeIdToIdent,
      typeIdentToEntryKeys
    );
    expect(encoded.author).toEqual({
      contentTypeIdentifier: 'BlogPost',
      entryKey: 'hello',
    });
    expect((encoded.tags as unknown[])[0]).toEqual({
      contentTypeIdentifier: 'BlogPost',
      entryKey: 'hello',
    });

    const decoded = decodeDataRefs(
      encoded,
      fieldTypes,
      identToTypeId,
      typeIdentToKeyToEntry
    );
    expect(decoded).toEqual(data);
  });

  it('leaves RICHTEXT data untouched in portable mode (cmsEmbed nodes no longer rewritten)', () => {
    const body = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Before embed.' }],
        },
        {
          type: 'cmsEmbed',
          attrs: {
            embedType: '11111111-1111-1111-1111-111111111111',
            embedId: '22222222-2222-2222-2222-222222222222',
          },
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'After embed.' }],
        },
      ],
    };
    const data = { body };
    const fieldTypes = { body: FIELD_TYPES.RICHTEXT };

    const encoded = encodeDataRefs(
      data,
      fieldTypes,
      typeIdToIdent,
      typeIdentToEntryKeys
    );
    expect(encoded.body).toEqual(body);

    const decoded = decodeDataRefs(
      encoded,
      fieldTypes,
      identToTypeId,
      typeIdentToKeyToEntry
    );
    expect(decoded.body).toEqual(body);
  });
});

describe('encode/decodeDataRefs — RICHTEXT embeds', () => {
  const fieldTypes = { body: FIELD_TYPES.RICHTEXT };
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'see ' },
          {
            type: 'cmsEmbed',
            attrs: { contentTypeId: 'aaa-uuid-ct', entryId: 'post-uuid-1' },
          },
        ],
      },
    ],
  };

  it('encodes embed attrs to portable identifier/key', () => {
    const out = encodeDataRefs(
      { body: doc },
      fieldTypes,
      typeIdToIdent,
      typeIdentToEntryKeys
    );
    const body = out.body as {
      content: { content: { attrs: unknown }[] }[];
    };
    const embed = body.content[0]!.content[1]!;
    expect(embed.attrs).toEqual({
      contentTypeIdentifier: 'BlogPost',
      entryKey: 'hello',
    });
  });

  it('decodes portable embed attrs back to uuid form', () => {
    const portableDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'cmsEmbed',
              attrs: {
                contentTypeIdentifier: 'BlogPost',
                entryKey: 'hello',
              },
            },
          ],
        },
      ],
    };
    const out = decodeDataRefs(
      { body: portableDoc },
      fieldTypes,
      identToTypeId,
      typeIdentToKeyToEntry
    );
    const body = out.body as {
      content: { content: { attrs: unknown }[] }[];
    };
    const embed = body.content[0]!.content[0]!;
    expect(embed.attrs).toEqual({
      contentTypeId: 'aaa-uuid-ct',
      entryId: 'post-uuid-1',
    });
  });

  it('passes through RICHTEXT values with no embeds untouched', () => {
    const plain = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
    };
    const out = encodeDataRefs(
      { body: plain },
      fieldTypes,
      typeIdToIdent,
      typeIdentToEntryKeys
    );
    expect(out.body).toEqual(plain);
  });

  it('walks nested content (embed inside blockquote inside doc)', () => {
    const nested = {
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'cmsEmbed',
                  attrs: {
                    contentTypeId: 'aaa-uuid-ct',
                    entryId: 'post-uuid-1',
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const out = encodeDataRefs(
      { body: nested },
      { body: FIELD_TYPES.RICHTEXT },
      typeIdToIdent,
      typeIdentToEntryKeys
    );
    const embed = (
      out.body as { content: { content: { content: unknown[] }[] }[] }
    ).content[0]!.content[0]!.content[0] as { attrs: unknown };
    expect(embed.attrs).toEqual({
      contentTypeIdentifier: 'BlogPost',
      entryKey: 'hello',
    });
  });

  it('rewrites multiple embeds in the same document independently', () => {
    const docTwo = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'cmsEmbed',
              attrs: { contentTypeId: 'aaa-uuid-ct', entryId: 'post-uuid-1' },
            },
            { type: 'text', text: ' and ' },
            {
              type: 'cmsEmbed',
              attrs: { contentTypeId: 'aaa-uuid-ct', entryId: 'post-uuid-1' },
            },
          ],
        },
      ],
    };
    const out = encodeDataRefs(
      { body: docTwo },
      { body: FIELD_TYPES.RICHTEXT },
      typeIdToIdent,
      typeIdentToEntryKeys
    );
    const para = (out.body as { content: { content: unknown[] }[] })
      .content[0]!;
    const first = para.content[0] as { attrs: unknown };
    const second = para.content[2] as { attrs: unknown };
    expect(first.attrs).toEqual({
      contentTypeIdentifier: 'BlogPost',
      entryKey: 'hello',
    });
    expect(second.attrs).toEqual({
      contentTypeIdentifier: 'BlogPost',
      entryKey: 'hello',
    });
  });

  it('does not mutate the input document', () => {
    const original = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'cmsEmbed',
              attrs: { contentTypeId: 'aaa-uuid-ct', entryId: 'post-uuid-1' },
            },
          ],
        },
      ],
    };
    const snapshot = JSON.parse(JSON.stringify(original));
    encodeDataRefs(
      { body: original },
      { body: FIELD_TYPES.RICHTEXT },
      typeIdToIdent,
      typeIdentToEntryKeys
    );
    expect(original).toEqual(snapshot);
  });
});
