import { describe, expect, it } from 'vitest';
import { mapFieldToConfig } from './mapFieldToConfig';
import { FIELD_TYPES } from './fieldTypes';

describe('mapFieldToConfig — JSON (#497)', () => {
  it('maps a JSON field to the json editor config', () => {
    expect(
      mapFieldToConfig({
        identifier: 'key',
        name: 'Key',
        type: FIELD_TYPES.JSON,
        required: true,
        options: null,
      })
    ).toStrictEqual({ type: 'json', key: 'key', label: 'Key', required: true });
  });
});
