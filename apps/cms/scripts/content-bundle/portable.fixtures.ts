// Test-support fixtures for portable.test.ts. NOT a test file (no *.test.ts
// glob match) and NOT vendored. These are mostly plain lookup Maps (the
// encode/decode reference tables) and ProseMirror-shaped `data` documents —
// they are data, not Bundles, so they do NOT flow through ./bundleFactories.
import type { FieldType } from '#prisma';
import { FIELD_TYPES } from '../../utils/fieldTypes';

// --- Encode-direction lookup tables (UUID -> portable) ---

/** contentTypeId -> identifier. */
export const typeIdToIdentifier = new Map([['aaa-uuid-ct', 'BlogPost']]);

/** identifier -> (entryId -> entryKey). */
export const entryKeysByTypeIdentifier = new Map([
  ['BlogPost', new Map([['post-uuid-1', 'hello']])],
]);

// --- Decode-direction lookup tables (portable -> UUID) ---

/** identifier -> contentTypeId. */
export const identifierToTypeId = new Map([['BlogPost', 'aaa-uuid-ct']]);

/** identifier -> (entryKey -> entryId). */
export const entryIdByTypeAndKey = new Map([
  [
    'BlogPost',
    new Map<string, string>([
      ['hello', 'post-uuid-1'],
      ['Hello', 'post-uuid-1'],
    ]),
  ],
]);

// --- Field-type maps ---

/** A single RICHTEXT `body` field. */
export const richtextFieldTypes: Record<string, FieldType> = {
  body: FIELD_TYPES.RICHTEXT,
};

/** Field-type map for the RELATION/MULTIRELATION round-trip data. */
export const relationRoundTripFieldTypes: Record<string, FieldType> = {
  title: FIELD_TYPES.ENTRY_TITLE,
  author: FIELD_TYPES.RELATION,
  tags: FIELD_TYPES.MULTIRELATION,
};

// --- Entry `data` records ---

/** Entry data with a RELATION (`author`) and a MULTIRELATION (`tags`). */
export const relationRoundTripData = {
  title: 'Post',
  author: { contentTypeId: 'aaa-uuid-ct', entryId: 'post-uuid-1' },
  tags: [{ contentTypeId: 'aaa-uuid-ct', entryId: 'post-uuid-1' }],
};

// --- ProseMirror documents ---

/**
 * Doc whose cmsEmbed carries legacy `embedType`/`embedId` attrs (not the
 * current contentTypeId/entryId shape) — exercises pass-through.
 */
export const proseMirrorWithLegacyEmbed = {
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

/** Doc with a single UUID-form cmsEmbed inside a paragraph (encode input). */
export const proseMirrorWithEmbed = {
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

/** Portable-form cmsEmbed doc (decode input). */
export const portableProseMirrorWithEmbed = {
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

/** Doc with no embeds — passes through untouched. */
export const proseMirrorPlain = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
};

/** cmsEmbed nested inside a blockquote inside the doc. */
export const proseMirrorNestedEmbed = {
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

/** Two cmsEmbeds in the same paragraph (rewritten independently). */
export const proseMirrorTwoEmbeds = {
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

/** Single cmsEmbed doc used for the no-input-mutation guard. */
export const proseMirrorSingleEmbed = {
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
