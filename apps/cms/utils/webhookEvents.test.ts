import { describe, it, expect } from 'vitest';
import { WEBHOOK_EVENT_OPTIONS, WEBHOOK_EVENT_NAMES } from './webhookEvents';

describe('webhookEvents registry', () => {
  it('lists all four events in order with labels and descriptions', () => {
    expect(WEBHOOK_EVENT_NAMES).toEqual([
      'ENTRY_PUBLISHED',
      'ENTRY_UNPUBLISHED',
      'ENTRY_DELETED',
      'CONTENT_TYPE_SCHEMA_CHANGED',
    ]);
    const schema = WEBHOOK_EVENT_OPTIONS.find(
      (e) => e.value === 'CONTENT_TYPE_SCHEMA_CHANGED'
    );
    expect(schema?.label).toBe('Content type schema changed');
    expect(schema?.description).toBeTruthy();
    expect(WEBHOOK_EVENT_OPTIONS).toHaveLength(4);
  });

  it('keeps WEBHOOK_EVENT_OPTIONS values in sync with WEBHOOK_EVENT_NAMES (same set)', () => {
    expect([...WEBHOOK_EVENT_OPTIONS.map((o) => o.value)].sort()).toEqual(
      [...WEBHOOK_EVENT_NAMES].sort()
    );
  });
});
