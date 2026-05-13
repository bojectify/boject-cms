import { describe, expect, it } from 'vitest';
import {
  parseFieldOptions,
  SelectOptionsSchema,
  RelationOptionsSchema,
  RichtextOptionsSchema,
} from './fieldOptions';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

describe('parseFieldOptions', () => {
  describe('null / missing / empty options', () => {
    it('returns empty defaults for SELECT when options is null', () => {
      expect(parseFieldOptions({ type: 'SELECT', options: null })).toEqual({
        type: 'SELECT',
        choices: [],
      });
    });

    it('returns empty defaults for RELATION when options is undefined', () => {
      expect(
        parseFieldOptions({ type: 'RELATION', options: undefined })
      ).toEqual({
        type: 'RELATION',
        targetContentTypeIds: [],
      });
    });

    it('returns empty defaults for RICHTEXT when options is {}', () => {
      expect(parseFieldOptions({ type: 'RICHTEXT', options: {} })).toEqual({
        type: 'RICHTEXT',
        targetContentTypeIds: [],
        linkTargetContentTypeIds: [],
      });
    });

    it('returns empty defaults for MULTIRELATION when targetContentTypeIds key is missing', () => {
      expect(parseFieldOptions({ type: 'MULTIRELATION', options: {} })).toEqual(
        {
          type: 'MULTIRELATION',
          targetContentTypeIds: [],
        }
      );
    });
  });

  describe('happy-path narrowing per branch', () => {
    it('parses SELECT choices', () => {
      expect(
        parseFieldOptions({
          type: 'SELECT',
          options: { choices: ['a', 'b', 'c'] },
        })
      ).toEqual({ type: 'SELECT', choices: ['a', 'b', 'c'] });
    });

    it('parses RELATION targetContentTypeIds', () => {
      expect(
        parseFieldOptions({
          type: 'RELATION',
          options: { targetContentTypeIds: [UUID_A, UUID_B] },
        })
      ).toEqual({
        type: 'RELATION',
        targetContentTypeIds: [UUID_A, UUID_B],
      });
    });

    it('parses MULTIRELATION targetContentTypeIds (same schema as RELATION)', () => {
      expect(
        parseFieldOptions({
          type: 'MULTIRELATION',
          options: { targetContentTypeIds: [UUID_A] },
        })
      ).toEqual({
        type: 'MULTIRELATION',
        targetContentTypeIds: [UUID_A],
      });
    });

    it('parses RICHTEXT with both allow-lists', () => {
      expect(
        parseFieldOptions({
          type: 'RICHTEXT',
          options: {
            targetContentTypeIds: [UUID_A],
            linkTargetContentTypeIds: [UUID_B],
          },
        })
      ).toEqual({
        type: 'RICHTEXT',
        targetContentTypeIds: [UUID_A],
        linkTargetContentTypeIds: [UUID_B],
      });
    });

    it('returns bare discriminator for no-payload types', () => {
      expect(parseFieldOptions({ type: 'TEXT', options: null })).toEqual({
        type: 'TEXT',
      });
      expect(parseFieldOptions({ type: 'BOOLEAN', options: {} })).toEqual({
        type: 'BOOLEAN',
      });
      expect(parseFieldOptions({ type: 'IMAGE', options: null })).toEqual({
        type: 'IMAGE',
      });
    });
  });

  describe('discriminator', () => {
    it('returns opts.type matching field.type', () => {
      const opts = parseFieldOptions({ type: 'SELECT', options: null });
      expect(opts.type).toBe('SELECT');
    });
  });

  describe('strictness — throws on malformed input', () => {
    it('throws on malformed UUID in RELATION targetContentTypeIds', () => {
      expect(() =>
        parseFieldOptions({
          type: 'RELATION',
          options: { targetContentTypeIds: ['not-a-uuid'] },
        })
      ).toThrow();
    });

    it('throws on malformed UUID in MULTIRELATION targetContentTypeIds', () => {
      expect(() =>
        parseFieldOptions({
          type: 'MULTIRELATION',
          options: { targetContentTypeIds: ['not-a-uuid'] },
        })
      ).toThrow();
    });

    it('throws on malformed UUID in RICHTEXT linkTargetContentTypeIds', () => {
      expect(() =>
        parseFieldOptions({
          type: 'RICHTEXT',
          options: { linkTargetContentTypeIds: ['not-a-uuid'] },
        })
      ).toThrow();
    });

    it('throws on non-string SELECT choices', () => {
      expect(() =>
        parseFieldOptions({
          type: 'SELECT',
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
