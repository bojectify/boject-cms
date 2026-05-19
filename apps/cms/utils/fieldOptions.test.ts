import { describe, expect, it } from 'vitest';
import {
  parseFieldOptions,
  SelectOptionsSchema,
  RelationOptionsSchema,
  RichtextOptionsSchema,
  getFieldOptionsErrorShape,
} from './fieldOptions';
import { FIELD_TYPES } from './fieldTypes';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

describe('parseFieldOptions', () => {
  describe('null / missing / empty options', () => {
    it('returns empty defaults for SELECT when options is null', () => {
      expect(
        parseFieldOptions({ type: FIELD_TYPES.SELECT, options: null })
      ).toEqual({
        type: FIELD_TYPES.SELECT,
        choices: [],
      });
    });

    it('returns empty defaults for RELATION when options is undefined', () => {
      expect(
        parseFieldOptions({ type: FIELD_TYPES.RELATION, options: undefined })
      ).toEqual({
        type: FIELD_TYPES.RELATION,
        targetContentTypeIds: [],
      });
    });

    it('returns empty defaults for RICHTEXT when options is {}', () => {
      expect(
        parseFieldOptions({ type: FIELD_TYPES.RICHTEXT, options: {} })
      ).toEqual({
        type: FIELD_TYPES.RICHTEXT,
        targetContentTypeIds: [],
        linkTargetContentTypeIds: [],
      });
    });

    it('returns empty defaults for MULTIRELATION when targetContentTypeIds key is missing', () => {
      expect(
        parseFieldOptions({ type: FIELD_TYPES.MULTIRELATION, options: {} })
      ).toEqual({
        type: FIELD_TYPES.MULTIRELATION,
        targetContentTypeIds: [],
      });
    });
  });

  describe('happy-path narrowing per branch', () => {
    it('parses SELECT choices', () => {
      expect(
        parseFieldOptions({
          type: FIELD_TYPES.SELECT,
          options: { choices: ['a', 'b', 'c'] },
        })
      ).toEqual({ type: FIELD_TYPES.SELECT, choices: ['a', 'b', 'c'] });
    });

    it('parses RELATION targetContentTypeIds', () => {
      expect(
        parseFieldOptions({
          type: FIELD_TYPES.RELATION,
          options: { targetContentTypeIds: [UUID_A, UUID_B] },
        })
      ).toEqual({
        type: FIELD_TYPES.RELATION,
        targetContentTypeIds: [UUID_A, UUID_B],
      });
    });

    it('parses MULTIRELATION targetContentTypeIds (same schema as RELATION)', () => {
      expect(
        parseFieldOptions({
          type: FIELD_TYPES.MULTIRELATION,
          options: { targetContentTypeIds: [UUID_A] },
        })
      ).toEqual({
        type: FIELD_TYPES.MULTIRELATION,
        targetContentTypeIds: [UUID_A],
      });
    });

    it('parses RICHTEXT with both allow-lists', () => {
      expect(
        parseFieldOptions({
          type: FIELD_TYPES.RICHTEXT,
          options: {
            targetContentTypeIds: [UUID_A],
            linkTargetContentTypeIds: [UUID_B],
          },
        })
      ).toEqual({
        type: FIELD_TYPES.RICHTEXT,
        targetContentTypeIds: [UUID_A],
        linkTargetContentTypeIds: [UUID_B],
      });
    });

    it('returns bare discriminator for no-payload types', () => {
      expect(
        parseFieldOptions({ type: FIELD_TYPES.TEXT, options: null })
      ).toEqual({
        type: FIELD_TYPES.TEXT,
      });
      expect(
        parseFieldOptions({ type: FIELD_TYPES.BOOLEAN, options: {} })
      ).toEqual({
        type: FIELD_TYPES.BOOLEAN,
      });
      expect(
        parseFieldOptions({ type: FIELD_TYPES.IMAGE, options: null })
      ).toEqual({
        type: FIELD_TYPES.IMAGE,
      });
    });
  });

  describe('discriminator', () => {
    it('returns opts.type matching field.type', () => {
      const opts = parseFieldOptions({
        type: FIELD_TYPES.SELECT,
        options: null,
      });
      expect(opts.type).toBe(FIELD_TYPES.SELECT);
    });
  });

  describe('strictness — throws on malformed input', () => {
    it('throws on malformed UUID in RELATION targetContentTypeIds', () => {
      expect(() =>
        parseFieldOptions({
          type: FIELD_TYPES.RELATION,
          options: { targetContentTypeIds: ['not-a-uuid'] },
        })
      ).toThrow();
    });

    it('throws on malformed UUID in MULTIRELATION targetContentTypeIds', () => {
      expect(() =>
        parseFieldOptions({
          type: FIELD_TYPES.MULTIRELATION,
          options: { targetContentTypeIds: ['not-a-uuid'] },
        })
      ).toThrow();
    });

    it('throws on malformed UUID in RICHTEXT linkTargetContentTypeIds', () => {
      expect(() =>
        parseFieldOptions({
          type: FIELD_TYPES.RICHTEXT,
          options: { linkTargetContentTypeIds: ['not-a-uuid'] },
        })
      ).toThrow();
    });

    it('throws on non-string SELECT choices', () => {
      expect(() =>
        parseFieldOptions({
          type: FIELD_TYPES.SELECT,
          options: { choices: ['ok', 42] },
        })
      ).toThrow();
    });

    it('throws on an unknown field.type string', () => {
      expect(() =>
        parseFieldOptions({ type: 'NONSENSE', options: null })
      ).toThrow(/unknown field type/);
    });
  });

  describe('getFieldOptionsErrorShape', () => {
    it('returns invalid_type for shape mismatches', () => {
      try {
        RelationOptionsSchema.parse({ targetContentTypeIds: 'not-an-array' });
      } catch (e) {
        expect(getFieldOptionsErrorShape(e)).toEqual({
          key: 'targetContentTypeIds',
          code: 'invalid_type',
        });
      }
    });

    it('returns invalid_uuid for malformed UUIDs', () => {
      try {
        RelationOptionsSchema.parse({ targetContentTypeIds: ['not-a-uuid'] });
      } catch (e) {
        expect(getFieldOptionsErrorShape(e)).toEqual({
          key: 'targetContentTypeIds',
          code: 'invalid_uuid',
        });
      }
    });

    it('picks linkTargetContentTypeIds when that key is the first issue', () => {
      try {
        RichtextOptionsSchema.parse({
          targetContentTypeIds: [],
          linkTargetContentTypeIds: ['not-a-uuid'],
        });
      } catch (e) {
        expect(getFieldOptionsErrorShape(e)?.key).toBe(
          'linkTargetContentTypeIds'
        );
      }
    });

    it('returns undefined for non-zod errors', () => {
      expect(getFieldOptionsErrorShape(new Error('not zod'))).toBeUndefined();
    });
  });

  describe('exported per-branch schemas', () => {
    it('SelectOptionsSchema parses choices directly', () => {
      expect(SelectOptionsSchema.parse({ choices: ['x'] })).toEqual({
        choices: ['x'],
      });
    });

    it('RelationOptionsSchema parses targetContentTypeIds directly', () => {
      expect(
        RelationOptionsSchema.parse({ targetContentTypeIds: [UUID_A] })
      ).toEqual({ targetContentTypeIds: [UUID_A] });
    });

    it('RichtextOptionsSchema parses both allow-lists directly', () => {
      expect(
        RichtextOptionsSchema.parse({
          targetContentTypeIds: [UUID_A],
          linkTargetContentTypeIds: [UUID_B],
        })
      ).toEqual({
        targetContentTypeIds: [UUID_A],
        linkTargetContentTypeIds: [UUID_B],
      });
    });
  });
});
