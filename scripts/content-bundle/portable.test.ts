import { describe, expect, it } from 'vitest';
import {
  encodeRelationRef,
  decodeRelationRef,
  encodeDataRefs,
  decodeDataRefs,
} from './portable';

const typeIdToIdent = new Map([['aaa-uuid-ct', 'BlogPost']]);
const typeIdentToEntryKeys = new Map([
  [
    'BlogPost',
    new Map([['post-uuid-1', { slug: 'hello', entryTitle: 'Hello' }]]),
  ],
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

  it('falls back to entryTitle when no slug is set', () => {
    const ref = encodeRelationRef(
      { contentTypeId: 'aaa-uuid-ct', entryId: 'post-uuid-1' },
      typeIdToIdent,
      new Map([
        [
          'BlogPost',
          new Map([['post-uuid-1', { slug: null, entryTitle: 'Hello' }]]),
        ],
      ])
    );
    expect(ref.entryKey).toBe('Hello');
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
      title: 'ENTRY_TITLE' as const,
      author: 'RELATION' as const,
      tags: 'MULTIRELATION' as const,
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

  it('passes RICHTEXT data through untouched', () => {
    const data = {
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello world' }],
          },
        ],
      },
    };
    const fieldTypes = { body: 'RICHTEXT' as const };

    const encoded = encodeDataRefs(
      data,
      fieldTypes,
      typeIdToIdent,
      typeIdentToEntryKeys
    );
    expect(encoded.body).toEqual(data.body);

    const decoded = decodeDataRefs(
      encoded,
      fieldTypes,
      identToTypeId,
      typeIdentToKeyToEntry
    );
    expect(decoded.body).toEqual(data.body);
  });
});
