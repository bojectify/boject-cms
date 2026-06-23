import { describe, it, expect, vi } from 'vitest';
import type { H3Event } from 'h3';
import type { TaggedCache } from './taggedCache';
import { withTaggedCache } from './withTaggedCache';

// Minimal h3 event stub: setResponseHeader(event, name, value) delegates to
// event.node.res.setHeader. We capture headers into a map to assert X-Cache.
function makeEvent() {
  const headers: Record<string, string> = {};
  const event = {
    node: {
      res: {
        setHeader: (name: string, value: string) => {
          headers[name] = value;
        },
        getHeader: (name: string) => headers[name],
      },
    },
  } as H3Event;
  return { event, headers };
}

function makeCache(overrides: Partial<TaggedCache> = {}): TaggedCache {
  const defaultCache: TaggedCache = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    invalidateByTag: vi.fn(async () => {}),
  };
  return { ...defaultCache, ...overrides };
}

const OPTS = { key: 'k', tags: ['content-type:Article'], ttl: 3600 };

describe('withTaggedCache', () => {
  it('returns the cached value and sets X-Cache: HIT without calling fn', async () => {
    const { event, headers } = makeEvent();
    const cache = makeCache();
    vi.mocked(cache.get).mockResolvedValue({ cached: true });
    const fn = vi.fn(async () => ({ cached: false }));

    const result = await withTaggedCache(event, OPTS, fn, cache);

    expect(result).toEqual({ cached: true });
    expect(fn).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
    expect(headers['X-Cache']).toBe('HIT');
  });

  it('on a miss calls fn, caches the result with tags+ttl, sets X-Cache: MISS', async () => {
    const { event, headers } = makeEvent();
    const cache = makeCache();
    const fn = vi.fn(async () => ({ data: 1 }));

    const result = await withTaggedCache(event, OPTS, fn, cache);

    expect(result).toEqual({ data: 1 });
    expect(fn).toHaveBeenCalledOnce();
    expect(cache.set).toHaveBeenCalledWith(
      'k',
      { data: 1 },
      {
        tags: ['content-type:Article'],
        ttl: 3600,
      }
    );
    expect(headers['X-Cache']).toBe('MISS');
  });

  it('on a get failure serves from origin with X-Cache: BYPASS and never sets', async () => {
    const { event, headers } = makeEvent();
    const cache = makeCache({
      get: vi.fn(async () => {
        throw new Error('redis down');
      }),
    });
    const fn = vi.fn(async () => ({ data: 2 }));

    const result = await withTaggedCache(event, OPTS, fn, cache);

    expect(result).toEqual({ data: 2 });
    expect(fn).toHaveBeenCalledOnce();
    expect(cache.set).not.toHaveBeenCalled();
    expect(headers['X-Cache']).toBe('BYPASS');
  });

  it('a set failure is best-effort: still returns the result as MISS', async () => {
    const { event, headers } = makeEvent();
    const cache = makeCache({
      set: vi.fn(async () => {
        throw new Error('redis down on write');
      }),
    });
    const fn = vi.fn(async () => ({ data: 3 }));

    const result = await withTaggedCache(event, OPTS, fn, cache);

    expect(result).toEqual({ data: 3 });
    expect(fn).toHaveBeenCalledOnce();
    expect(headers['X-Cache']).toBe('MISS');
  });
});
