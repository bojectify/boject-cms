import { describe, it, expect } from 'vitest';
import { parseUniqueConflict } from './parseUniqueConflict';

describe('parseUniqueConflict', () => {
  it('returns null for non-errors', () => {
    expect(parseUniqueConflict(null)).toBeNull();
    expect(parseUniqueConflict('some string')).toBeNull();
    expect(parseUniqueConflict({})).toBeNull();
  });

  it('returns null when statusCode is not 409', () => {
    expect(
      parseUniqueConflict({
        statusCode: 400,
        data: { data: { error: 'UNIQUE_CONFLICT' } },
      })
    ).toBeNull();
  });

  it('returns null when error code is not UNIQUE_CONFLICT', () => {
    expect(
      parseUniqueConflict({
        statusCode: 409,
        data: { data: { error: 'SOMETHING_ELSE' } },
      })
    ).toBeNull();
  });

  it('parses an entry-level UNIQUE_CONFLICT', () => {
    const result = parseUniqueConflict({
      statusCode: 409,
      data: {
        data: {
          error: 'UNIQUE_CONFLICT',
          field: 'sku',
          message: 'SKU must be unique',
          value: 'ABC-123',
        },
      },
    });
    expect(result).toEqual({
      kind: 'entry',
      field: 'sku',
      message: 'SKU must be unique',
      value: 'ABC-123',
    });
  });

  it('parses a field-level UNIQUE_CONFLICT with conflicts array', () => {
    const result = parseUniqueConflict({
      statusCode: 409,
      data: {
        data: {
          error: 'UNIQUE_CONFLICT',
          message: 'Duplicates detected',
          conflicts: [{ value: 'DUP', entryIds: ['a', 'b'] }],
        },
      },
    });
    expect(result).toEqual({
      kind: 'field',
      message: 'Duplicates detected',
      conflicts: [{ value: 'DUP', entryIds: ['a', 'b'] }],
    });
  });

  it('handles flat data payload (no nested data.data)', () => {
    const result = parseUniqueConflict({
      statusCode: 409,
      data: {
        error: 'UNIQUE_CONFLICT',
        field: 'sku',
        message: 'SKU must be unique',
        value: 'X',
      },
    });
    expect(result).toEqual({
      kind: 'entry',
      field: 'sku',
      message: 'SKU must be unique',
      value: 'X',
    });
  });
});
