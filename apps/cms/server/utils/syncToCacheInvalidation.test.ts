import { describe, it, expect, vi } from 'vitest';
import { syncToCacheInvalidation } from './syncToCacheInvalidation';

function makeFakeCache() {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      cache: {
        invalidateByTag: vi.fn(async (tag: string) => {
          calls.push(tag);
        }),
      },
    },
  };
}

const entryPayload = (event: string) => ({
  event,
  contentType: { id: 'ct1', identifier: 'Article' },
  entry: { id: 'e1' },
});

describe('syncToCacheInvalidation', () => {
  it.each(['ENTRY_PUBLISHED', 'ENTRY_UNPUBLISHED', 'ENTRY_DELETED'])(
    '%s clears the content-type tag and the per-entry tag',
    async (event) => {
      const { calls, deps } = makeFakeCache();
      await syncToCacheInvalidation(deps, entryPayload(event));
      expect(calls.sort()).toEqual(
        ['content-type:Article', 'entry:Article:e1'].sort()
      );
    }
  );

  it('CONTENT_TYPE_SCHEMA_CHANGED clears the content-type tag only', async () => {
    const { calls, deps } = makeFakeCache();
    await syncToCacheInvalidation(deps, {
      event: 'CONTENT_TYPE_SCHEMA_CHANGED',
      contentTypeId: 'ct1',
      contentTypeIdentifier: 'Article',
    });
    expect(calls).toEqual(['content-type:Article']);
  });

  it('CONTENT_BULK_SYNC clears the content-type tag only (same as schema-changed)', async () => {
    const { calls, deps } = makeFakeCache();
    await syncToCacheInvalidation(deps, {
      event: 'CONTENT_BULK_SYNC',
      contentTypeId: 'ct1',
      contentTypeIdentifier: 'Article',
    });
    expect(calls).toEqual(['content-type:Article']);
  });

  it('does not clear the per-entry tag when the entry id is absent', async () => {
    const { calls, deps } = makeFakeCache();
    await syncToCacheInvalidation(deps, {
      event: 'ENTRY_PUBLISHED',
      contentType: { id: 'ct1', identifier: 'Article' },
    });
    expect(calls).toEqual(['content-type:Article']);
  });

  it('is a no-op for an unsubscribed event (ENTRY_DRAFT_SYNC)', async () => {
    const { calls, deps } = makeFakeCache();
    await syncToCacheInvalidation(deps, {
      event: 'ENTRY_DRAFT_SYNC',
      contentTypeId: 'ct1',
      entry: { id: 'e1' },
    });
    expect(calls).toEqual([]);
  });

  it('is a no-op for a schema event missing contentTypeIdentifier', async () => {
    const { calls, deps } = makeFakeCache();
    await expect(
      syncToCacheInvalidation(deps, { event: 'CONTENT_TYPE_SCHEMA_CHANGED' })
    ).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('is a no-op (no throw) for a malformed entry payload missing the identifier', async () => {
    const { calls, deps } = makeFakeCache();
    await expect(
      syncToCacheInvalidation(deps, { event: 'ENTRY_PUBLISHED' })
    ).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('propagates a cache failure so the worker can retry', async () => {
    const deps = {
      cache: {
        invalidateByTag: vi.fn(async () => {
          throw new Error('redis down');
        }),
      },
    };
    await expect(
      syncToCacheInvalidation(deps, entryPayload('ENTRY_PUBLISHED'))
    ).rejects.toThrow('redis down');
  });
});
