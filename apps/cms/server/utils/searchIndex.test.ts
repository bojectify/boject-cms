import { describe, it, expect, afterEach } from 'vitest';
import type { Meilisearch } from 'meilisearch';
import {
  ensureEntriesIndex,
  resolveEntriesIndex,
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
    await ensureEntriesIndex(client, ENTRIES_INDEX);

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
    await ensureEntriesIndex(client, ENTRIES_INDEX);

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

describe('ENTRIES_INDEX_SETTINGS', () => {
  it('makes entryTitle + nested fields searchable', () => {
    expect(ENTRIES_INDEX_SETTINGS.searchableAttributes).toEqual([
      'entryTitle',
      'fields',
    ]);
  });
  it('makes contentType, entryKey, and nested fields filterable', () => {
    expect(ENTRIES_INDEX_SETTINGS.filterableAttributes).toEqual([
      'contentType',
      'entryKey',
      'fields',
    ]);
  });
});

describe('resolveEntriesIndex', () => {
  const original = process.env.MEILI_INDEX;
  afterEach(() => {
    if (original === undefined) delete process.env.MEILI_INDEX;
    else process.env.MEILI_INDEX = original;
  });

  it('defaults to ENTRIES_INDEX when MEILI_INDEX is unset', () => {
    delete process.env.MEILI_INDEX;
    expect(resolveEntriesIndex()).toBe(ENTRIES_INDEX);
  });

  it('falls back to ENTRIES_INDEX when MEILI_INDEX is an empty string', () => {
    process.env.MEILI_INDEX = '';
    expect(resolveEntriesIndex()).toBe(ENTRIES_INDEX);
  });

  it('returns the MEILI_INDEX override when set', () => {
    process.env.MEILI_INDEX = 'entries_test';
    expect(resolveEntriesIndex()).toBe('entries_test');
  });
});

describe('ensureEntriesIndex index resolution', () => {
  const original = process.env.MEILI_INDEX;
  afterEach(() => {
    if (original === undefined) delete process.env.MEILI_INDEX;
    else process.env.MEILI_INDEX = original;
  });

  it('creates the index named by resolveEntriesIndex() when no index arg is given', async () => {
    process.env.MEILI_INDEX = 'entries_test';
    const { client, calls } = makeFakeClient([]);
    await ensureEntriesIndex(client);
    const create = calls.find((c) => c.method === 'createIndex');
    expect(create!.args).toEqual(['entries_test', { primaryKey: 'id' }]);
  });
});
