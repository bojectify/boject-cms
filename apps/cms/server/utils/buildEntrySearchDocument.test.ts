import { describe, it, expect } from 'vitest';
import { buildEntrySearchDocument } from './buildEntrySearchDocument';
import { FIELD_TYPES } from '../../utils/fieldTypes';

describe('buildEntrySearchDocument', () => {
  it('maps a loaded entry to a SearchDocument (title from the published version, ISO publishedAt, fields)', () => {
    const doc = buildEntrySearchDocument({
      id: 'e1',
      entryKey: 'first-post',
      contentType: {
        identifier: 'Article',
        fields: [
          { identifier: 'title', type: FIELD_TYPES.ENTRY_TITLE },
          { identifier: 'body', type: FIELD_TYPES.TEXT },
        ],
      },
      versions: [
        {
          entryTitle: 'First post',
          publishedAt: new Date('2026-01-01T00:00:00.000Z'),
          data: { title: 'First post', body: 'hello' },
        },
      ],
    });

    expect(doc).toEqual({
      id: 'e1',
      entryKey: 'first-post',
      contentType: 'Article',
      entryTitle: 'First post',
      publishedAt: '2026-01-01T00:00:00.000Z',
      fields: { body: 'hello' },
    });
  });

  it('emits null publishedAt when the version has none', () => {
    const doc = buildEntrySearchDocument({
      id: 'e2',
      entryKey: 'k2',
      contentType: { identifier: 'Page', fields: [] },
      versions: [{ entryTitle: 'P', publishedAt: null, data: {} }],
    });
    expect(doc.publishedAt).toBeNull();
  });
});
