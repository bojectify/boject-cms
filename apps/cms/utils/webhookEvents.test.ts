import { describe, it, expect } from 'vitest';
import {
  WEBHOOK_EVENT_OPTIONS,
  WEBHOOK_EVENT_NAMES,
  EXTERNAL_WEBHOOK_EVENT_NAMES,
  isWebhookEventName,
  isExternalWebhookEventName,
} from './webhookEvents';

describe('webhookEvents registry', () => {
  it('WEBHOOK_EVENT_NAMES includes the internal ENTRY_DRAFT_SYNC', () => {
    expect(WEBHOOK_EVENT_NAMES).toEqual([
      'ENTRY_PUBLISHED',
      'ENTRY_UNPUBLISHED',
      'ENTRY_DELETED',
      'CONTENT_TYPE_SCHEMA_CHANGED',
      'ENTRY_DRAFT_SYNC',
    ]);
  });

  it('EXTERNAL_WEBHOOK_EVENT_NAMES excludes ENTRY_DRAFT_SYNC', () => {
    expect(EXTERNAL_WEBHOOK_EVENT_NAMES).toEqual([
      'ENTRY_PUBLISHED',
      'ENTRY_UNPUBLISHED',
      'ENTRY_DELETED',
      'CONTENT_TYPE_SCHEMA_CHANGED',
    ]);
  });

  it('the external UI options match the external (not full) name set', () => {
    expect([...WEBHOOK_EVENT_OPTIONS.map((o) => o.value)].sort()).toEqual(
      [...EXTERNAL_WEBHOOK_EVENT_NAMES].sort()
    );
    expect(WEBHOOK_EVENT_OPTIONS).toHaveLength(4);
  });

  it('isWebhookEventName accepts every enum value incl. ENTRY_DRAFT_SYNC', () => {
    expect(isWebhookEventName('ENTRY_DRAFT_SYNC')).toBe(true);
    expect(isWebhookEventName('ENTRY_PUBLISHED')).toBe(true);
    expect(isWebhookEventName('NOT_AN_EVENT')).toBe(false);
  });

  it('isExternalWebhookEventName rejects ENTRY_DRAFT_SYNC but accepts external ones', () => {
    expect(isExternalWebhookEventName('ENTRY_DRAFT_SYNC')).toBe(false);
    expect(isExternalWebhookEventName('ENTRY_PUBLISHED')).toBe(true);
    expect(isExternalWebhookEventName(42)).toBe(false);
  });
});
