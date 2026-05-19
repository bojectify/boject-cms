import { describe, it, expect } from 'vitest';
import { buildWebhookPayload } from './webhookPayload';
import { CONTENT_STATUSES } from '../../utils/contentStatus';

describe('buildWebhookPayload', () => {
  const timestamp = new Date('2026-04-22T12:00:00Z');
  const contentType = { id: 'ct-1', identifier: 'Article' };
  const entry = {
    id: 'e-1',
    entryTitle: 'Hello',
    slug: 'hello',
    status: CONTENT_STATUSES.PUBLISHED,
    publishedAt: new Date('2026-04-22T11:00:00Z'),
    createdAt: new Date('2026-04-22T10:00:00Z'),
    updatedAt: new Date('2026-04-22T11:00:00Z'),
    data: { title: 'Hello', body: 'world' },
  };

  it('returns the documented shape for ENTRY_PUBLISHED', () => {
    const payload = buildWebhookPayload({
      event: 'ENTRY_PUBLISHED',
      deliveryId: 'd-1',
      timestamp,
      contentType,
      entry,
    });
    expect(payload).toEqual({
      event: 'ENTRY_PUBLISHED',
      deliveryId: 'd-1',
      timestamp: '2026-04-22T12:00:00.000Z',
      contentType,
      entry: {
        id: 'e-1',
        entryTitle: 'Hello',
        slug: 'hello',
        status: CONTENT_STATUSES.PUBLISHED,
        publishedAt: '2026-04-22T11:00:00.000Z',
        createdAt: '2026-04-22T10:00:00.000Z',
        updatedAt: '2026-04-22T11:00:00.000Z',
        data: { title: 'Hello', body: 'world' },
      },
    });
  });

  it('uses the same shape for ENTRY_DELETED with the last-known snapshot', () => {
    const payload = buildWebhookPayload({
      event: 'ENTRY_DELETED',
      deliveryId: 'd-2',
      timestamp,
      contentType,
      entry,
    });
    expect(payload.event).toBe('ENTRY_DELETED');
    expect(payload.entry.entryTitle).toBe('Hello');
  });

  it('serialises null slug without dropping the key', () => {
    const payload = buildWebhookPayload({
      event: 'ENTRY_PUBLISHED',
      deliveryId: 'd-3',
      timestamp,
      contentType,
      entry: { ...entry, slug: null },
    });
    expect(payload.entry.slug).toBeNull();
  });
});
