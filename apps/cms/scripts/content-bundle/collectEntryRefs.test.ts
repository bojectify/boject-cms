import { describe, expect, it } from 'vitest';
import { collectEntryRefs } from './collectEntryRefs';
import { FIELD_TYPES } from '../../utils/fieldTypes';
import type { FieldType } from '#prisma';

const fieldTypes: Record<string, FieldType> = {
  title: FIELD_TYPES.ENTRY_TITLE,
  author: FIELD_TYPES.RELATION,
  tags: FIELD_TYPES.MULTIRELATION,
  body: FIELD_TYPES.RICHTEXT,
  count: FIELD_TYPES.NUMBER,
};

describe('collectEntryRefs', () => {
  it('collects a RELATION entryId tagged with its field', () => {
    const refs = collectEntryRefs(
      { author: { contentTypeId: 'ct-1', entryId: 'e-1' } },
      fieldTypes
    );
    expect(refs).toEqual([
      { contentTypeId: 'ct-1', entryId: 'e-1', fieldIdentifier: 'author' },
    ]);
  });

  it('collects every MULTIRELATION entryId in order', () => {
    const refs = collectEntryRefs(
      {
        tags: [
          { contentTypeId: 'ct-2', entryId: 'e-2' },
          { contentTypeId: 'ct-2', entryId: 'e-3' },
        ],
      },
      fieldTypes
    );
    expect(refs.map((r) => r.entryId)).toEqual(['e-2', 'e-3']);
    expect(refs.every((r) => r.fieldIdentifier === 'tags')).toBe(true);
  });

  it('collects RICHTEXT cmsEmbed/cmsLink refs via collectRichtextReferences', () => {
    const body = {
      type: 'doc',
      content: [
        { type: 'cmsEmbed', attrs: { contentTypeId: 'ct-4', entryId: 'e-4' } },
        { type: 'cmsLink', attrs: { contentTypeId: 'ct-5', entryId: 'e-5' } },
      ],
    };
    const refs = collectEntryRefs({ body }, fieldTypes);
    expect(refs.map((r) => r.entryId).sort()).toEqual(['e-4', 'e-5']);
    expect(refs.every((r) => r.fieldIdentifier === 'body')).toBe(true);
  });

  it('ignores scalar fields, null values, and unknown field types', () => {
    expect(
      collectEntryRefs(
        { title: 'Hi', count: 5, author: null, mystery: { entryId: 'x' } },
        fieldTypes
      )
    ).toEqual([]);
  });

  it('skips malformed RELATION refs (missing/empty ids)', () => {
    expect(
      collectEntryRefs({ author: { contentTypeId: 'ct-1' } }, fieldTypes)
    ).toEqual([]);
    expect(
      collectEntryRefs(
        { author: { contentTypeId: '', entryId: '' } },
        fieldTypes
      )
    ).toEqual([]);
  });

  it('skips a MULTIRELATION value that is not an array', () => {
    expect(
      collectEntryRefs(
        { tags: { contentTypeId: 'ct', entryId: 'e' } }, // object, not array
        fieldTypes
      )
    ).toEqual([]);
  });

  it('returns no refs for a non-object RICHTEXT value', () => {
    expect(
      collectEntryRefs({ body: 'just a plain string' }, fieldTypes)
    ).toEqual([]);
  });
});
