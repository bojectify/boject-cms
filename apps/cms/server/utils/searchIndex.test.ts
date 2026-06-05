import { describe, it, expect } from 'vitest';
import type { Meilisearch } from 'meilisearch';
import {
  ensureEntriesIndex,
  ENTRIES_INDEX,
  ENTRIES_INDEX_SETTINGS,
} from './searchIndex';

type Call = { method: string; args: unknown[] };

function makeFakeClient(existingUids: string[]) {
  const calls: Call[] = [];
  const client = {
    getIndexes: async (params?: unknown) => {
      calls.push({ method: 'getIndexes', args: [params] });
      return { results: existingUids.map((uid) => ({ uid })) };
    },
    createIndex: (uid: string, options?: unknown) => {
      calls.push({ method: 'createIndex', args: [uid, options] });
      return { waitTask: async () => ({}) };
    },
    index: (uid: string) => ({
      updateSettings: (settings: unknown) => {
        calls.push({ method: 'updateSettings', args: [uid, settings] });
        return { waitTask: async () => ({}) };
      },
    }),
  };
  // eslint-disable-next-line no-restricted-syntax -- minimal fake has insufficient overlap with the full Meilisearch client type
  return { client: client as unknown as Meilisearch, calls };
}

describe('ensureEntriesIndex', () => {
  it('creates the index with primaryKey id then applies settings when absent', async () => {
    const { client, calls } = makeFakeClient([]);
    await ensureEntriesIndex(client);

    // Membership is probed with an explicit high limit so the single global
    // index is never missed behind Meilisearch's default-20 pagination.
    const list = calls.find((c) => c.method === 'getIndexes');
    expect(list!.args).toEqual([{ limit: 1000 }]);

    const create = calls.find((c) => c.method === 'createIndex');
    expect(create).toBeDefined();
    expect(create!.args).toEqual([ENTRIES_INDEX, { primaryKey: 'id' }]);

    const settings = calls.find((c) => c.method === 'updateSettings');
    expect(settings).toBeDefined();
    expect(settings!.args).toEqual([ENTRIES_INDEX, ENTRIES_INDEX_SETTINGS]);

    // create must precede settings: applying settings to a not-yet-created
    // index would fail, so this ordering is the idempotency barrier.
    const createIdx = calls.findIndex((c) => c.method === 'createIndex');
    const settingsIdx = calls.findIndex((c) => c.method === 'updateSettings');
    expect(createIdx).toBeLessThan(settingsIdx);
  });

  it('does not create the index when it already exists, but still converges settings', async () => {
    const { client, calls } = makeFakeClient([ENTRIES_INDEX]);
    await ensureEntriesIndex(client);

    expect(calls.some((c) => c.method === 'createIndex')).toBe(false);
    expect(calls.some((c) => c.method === 'updateSettings')).toBe(true);
  });

  it('propagates errors when Meilisearch is unreachable', async () => {
    // eslint-disable-next-line no-restricted-syntax -- minimal fake has insufficient overlap with the full Meilisearch client type
    const client = {
      getIndexes: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:7700');
      },
    } as unknown as Meilisearch;
    await expect(ensureEntriesIndex(client)).rejects.toThrow(/ECONNREFUSED/);
  });
});
