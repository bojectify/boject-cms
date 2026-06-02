import { describe, expect, it } from 'vitest';
import {
  encodeRelationRef,
  decodeRelationRef,
  encodeDataRefs,
  decodeDataRefs,
} from './portable';
import {
  typeIdToIdentifier,
  entryKeysByTypeIdentifier,
  identifierToTypeId,
  entryIdByTypeAndKey,
  richtextFieldTypes,
  relationRoundTripFieldTypes,
  relationRoundTripData,
  proseMirrorWithLegacyEmbed,
  proseMirrorWithEmbed,
  portableProseMirrorWithEmbed,
  proseMirrorPlain,
  proseMirrorNestedEmbed,
  proseMirrorTwoEmbeds,
  proseMirrorSingleEmbed,
} from './portable.fixtures';

describe('encodeRelationRef', () => {
  it('rewrites a UUID ref to identifier + slug', () => {
    const ref = encodeRelationRef(
      { contentTypeId: 'aaa-uuid-ct', entryId: 'post-uuid-1' },
      typeIdToIdentifier,
      entryKeysByTypeIdentifier
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
        typeIdToIdentifier,
        new Map([['BlogPost', new Map()]])
      )
    ).toThrow(/has no entryKey/);
  });

  it('throws when ref cannot be resolved', () => {
    expect(() =>
      encodeRelationRef(
        { contentTypeId: 'missing', entryId: 'missing' },
        typeIdToIdentifier,
        entryKeysByTypeIdentifier
      )
    ).toThrow();
  });
});

describe('decodeRelationRef', () => {
  it('resolves identifier + slug back to UUIDs', () => {
    const ref = decodeRelationRef(
      { contentTypeIdentifier: 'BlogPost', entryKey: 'hello' },
      identifierToTypeId,
      entryIdByTypeAndKey
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
        identifierToTypeId,
        entryIdByTypeAndKey
      )
    ).toThrow();
  });
});

describe('encodeDataRefs / decodeDataRefs round-trip', () => {
  it('walks and rewrites RELATION values inside data', () => {
    const data = relationRoundTripData;
    const fieldTypes = relationRoundTripFieldTypes;

    const encoded = encodeDataRefs(
      data,
      fieldTypes,
      typeIdToIdentifier,
      entryKeysByTypeIdentifier
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
      identifierToTypeId,
      entryIdByTypeAndKey
    );
    expect(decoded).toEqual(data);
  });

  it('leaves RICHTEXT data untouched in portable mode (cmsEmbed nodes no longer rewritten)', () => {
    const body = proseMirrorWithLegacyEmbed;
    const data = { body };
    const fieldTypes = richtextFieldTypes;

    const encoded = encodeDataRefs(
      data,
      fieldTypes,
      typeIdToIdentifier,
      entryKeysByTypeIdentifier
    );
    expect(encoded.body).toEqual(body);

    const decoded = decodeDataRefs(
      encoded,
      fieldTypes,
      identifierToTypeId,
      entryIdByTypeAndKey
    );
    expect(decoded.body).toEqual(body);
  });
});

describe('encode/decodeDataRefs — RICHTEXT embeds', () => {
  const fieldTypes = richtextFieldTypes;
  const doc = proseMirrorWithEmbed;

  it('encodes embed attrs to portable identifier/key', () => {
    const out = encodeDataRefs(
      { body: doc },
      fieldTypes,
      typeIdToIdentifier,
      entryKeysByTypeIdentifier
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
    const portableDoc = portableProseMirrorWithEmbed;
    const out = decodeDataRefs(
      { body: portableDoc },
      fieldTypes,
      identifierToTypeId,
      entryIdByTypeAndKey
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
    const plain = proseMirrorPlain;
    const out = encodeDataRefs(
      { body: plain },
      fieldTypes,
      typeIdToIdentifier,
      entryKeysByTypeIdentifier
    );
    expect(out.body).toEqual(plain);
  });

  it('walks nested content (embed inside blockquote inside doc)', () => {
    const nested = proseMirrorNestedEmbed;
    const out = encodeDataRefs(
      { body: nested },
      richtextFieldTypes,
      typeIdToIdentifier,
      entryKeysByTypeIdentifier
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
    const docTwo = proseMirrorTwoEmbeds;
    const out = encodeDataRefs(
      { body: docTwo },
      richtextFieldTypes,
      typeIdToIdentifier,
      entryKeysByTypeIdentifier
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
    const original = proseMirrorSingleEmbed;
    const snapshot = JSON.parse(JSON.stringify(original));
    encodeDataRefs(
      { body: original },
      richtextFieldTypes,
      typeIdToIdentifier,
      entryKeysByTypeIdentifier
    );
    expect(original).toEqual(snapshot);
  });
});
