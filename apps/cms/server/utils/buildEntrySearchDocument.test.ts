import { describe, it, expect } from 'vitest';
import { buildEntrySearchDocuments } from './buildEntrySearchDocument';
import { FIELD_TYPES } from '../../utils/fieldTypes';
import { CONTENT_STATUSES } from '../../utils/contentStatus';

const fields = [
  { identifier: 'title', type: FIELD_TYPES.ENTRY_TITLE },
  { identifier: 'body', type: FIELD_TYPES.TEXT },
];

describe('buildEntrySearchDocuments', () => {
  it('maps a published-only entry to one PUBLISHED doc (isWorkingVersion true)', () => {
    const docs = buildEntrySearchDocuments({
      id: 'e1',
      entryKey: 'first-post',
      contentType: { identifier: 'Article', fields },
      versions: [
        {
          entryTitle: 'First post',
          publishedAt: new Date('2026-01-01T00:00:00.000Z'),
          data: { title: 'First post', body: 'hello' },
          status: CONTENT_STATUSES.PUBLISHED,
        },
      ],
    });
    expect(docs).toEqual([
      {
        id: 'e1__PUBLISHED',
        entryId: 'e1',
        status: 'PUBLISHED',
        isWorkingVersion: true,
        entryKey: 'first-post',
        contentType: 'Article',
        entryTitle: 'First post',
        publishedAt: '2026-01-01T00:00:00.000Z',
        fields: { body: 'hello' },
      },
    ]);
  });

  it('two-slot entry: PUBLISHED + CHANGED → two docs, CHANGED is the working version', () => {
    const docs = buildEntrySearchDocuments({
      id: 'e2',
      entryKey: 'two-slot',
      contentType: { identifier: 'Article', fields },
      versions: [
        {
          entryTitle: 'Live',
          publishedAt: new Date('2026-01-01T00:00:00.000Z'),
          data: { title: 'Live', body: 'live body' },
          status: CONTENT_STATUSES.PUBLISHED,
        },
        {
          entryTitle: 'Edited',
          publishedAt: null,
          data: { title: 'Edited', body: 'draft body' },
          status: CONTENT_STATUSES.CHANGED,
        },
      ],
    });
    const byStatus = Object.fromEntries(docs.map((d) => [d.status, d]));
    expect(docs).toHaveLength(2);
    expect(byStatus.PUBLISHED!.id).toBe('e2__PUBLISHED');
    expect(byStatus.PUBLISHED!.isWorkingVersion).toBe(false);
    expect(byStatus.PUBLISHED!.entryTitle).toBe('Live');
    expect(byStatus.PUBLISHED!.fields.body).toBe('live body');
    expect(byStatus.CHANGED!.id).toBe('e2__CHANGED');
    expect(byStatus.CHANGED!.isWorkingVersion).toBe(true);
    expect(byStatus.CHANGED!.entryTitle).toBe('Edited');
    expect(byStatus.CHANGED!.publishedAt).toBeNull();
  });

  it('draft-only entry: one DRAFT doc, working version true', () => {
    const docs = buildEntrySearchDocuments({
      id: 'e3',
      entryKey: 'drafty',
      contentType: { identifier: 'Page', fields: [] },
      versions: [
        {
          entryTitle: 'Drafty',
          publishedAt: null,
          data: {},
          status: CONTENT_STATUSES.DRAFT,
        },
      ],
    });
    expect(docs).toHaveLength(1);
    expect(docs[0]!.id).toBe('e3__DRAFT');
    expect(docs[0]!.isWorkingVersion).toBe(true);
  });

  it('excludes ARCHIVED versions entirely', () => {
    const docs = buildEntrySearchDocuments({
      id: 'e4',
      entryKey: 'arch',
      contentType: { identifier: 'Page', fields: [] },
      versions: [
        {
          entryTitle: 'Old',
          publishedAt: new Date('2026-01-01T00:00:00.000Z'),
          data: {},
          status: CONTENT_STATUSES.ARCHIVED,
        },
      ],
    });
    expect(docs).toEqual([]);
  });
});
