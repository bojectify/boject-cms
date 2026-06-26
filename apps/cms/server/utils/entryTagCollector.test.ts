import { describe, it, expect } from 'vitest';
import {
  recordResolvedEntry,
  withEntryCollection,
  decodeCollected,
} from './entryTagCollector';

describe('entryTagCollector', () => {
  it('records (contentTypeId, id) pairs inside an active scope', () => {
    const collected = new Set<string>();
    withEntryCollection(collected, () => {
      recordResolvedEntry('ct-1', 'e-1');
      recordResolvedEntry('ct-2', 'e-2');
    });
    expect(decodeCollected(collected)).toEqual([
      { contentTypeId: 'ct-1', id: 'e-1' },
      { contentTypeId: 'ct-2', id: 'e-2' },
    ]);
  });

  it('dedupes repeated pairs', () => {
    const collected = new Set<string>();
    withEntryCollection(collected, () => {
      recordResolvedEntry('ct-1', 'e-1');
      recordResolvedEntry('ct-1', 'e-1');
    });
    expect(decodeCollected(collected)).toHaveLength(1);
  });

  it('keeps concurrent scopes isolated', async () => {
    const a = new Set<string>();
    const b = new Set<string>();
    await Promise.all([
      withEntryCollection(a, async () => {
        recordResolvedEntry('ct-a', 'a-1');
        await Promise.resolve();
        recordResolvedEntry('ct-a', 'a-2');
      }),
      withEntryCollection(b, async () => {
        recordResolvedEntry('ct-b', 'b-1');
        await Promise.resolve();
        recordResolvedEntry('ct-b', 'b-2');
      }),
    ]);
    expect(decodeCollected(a).map((e) => e.id)).toEqual(['a-1', 'a-2']);
    expect(decodeCollected(b).map((e) => e.id)).toEqual(['b-1', 'b-2']);
  });

  it('is a silent no-op outside any scope', () => {
    expect(() => recordResolvedEntry('ct-1', 'e-1')).not.toThrow();
  });
});
