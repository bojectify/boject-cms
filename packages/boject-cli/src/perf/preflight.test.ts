import { afterEach, describe, expect, it, vi } from 'vitest';
import { runPreflight } from './preflight.js';
import * as introspectModule from './introspect.js';

afterEach(() => vi.restoreAllMocks());

const baseParams = {
  url: 'https://cms.example.com',
  apiKey: 'boject_test',
  contentTypeIdentifier: 'Article',
  filterFieldOverride: undefined as string | undefined,
  relationFieldOverride: undefined as string | undefined,
  k6Available: async () => true,
  fetchHealth: async () => ({ ok: true as const }),
};

const okIntrospect = {
  ok: true as const,
  listField: 'articleList',
  datetimeFields: ['publishDate', 'createdAt'],
  singleTargetRelationFields: ['author', 'category'],
};

describe('runPreflight', () => {
  it('returns ok with auto-introspected fields when no overrides', async () => {
    vi.spyOn(introspectModule, 'introspectContentType').mockResolvedValue(
      okIntrospect
    );
    const r = await runPreflight(baseParams);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fields.listField).toBe('articleList');
    expect(r.fields.filterField).toBe('publishDate');
    expect(r.fields.relationField).toBe('author');
  });

  it('honours overrides when valid', async () => {
    vi.spyOn(introspectModule, 'introspectContentType').mockResolvedValue(
      okIntrospect
    );
    const r = await runPreflight({
      ...baseParams,
      filterFieldOverride: 'createdAt',
      relationFieldOverride: 'category',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fields.filterField).toBe('createdAt');
    expect(r.fields.relationField).toBe('category');
  });

  it('returns error when override field does not exist', async () => {
    vi.spyOn(introspectModule, 'introspectContentType').mockResolvedValue(
      okIntrospect
    );
    const r = await runPreflight({
      ...baseParams,
      filterFieldOverride: 'nope',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join('\n')).toMatch(/filter-field/);
    expect(r.errors.join('\n')).toMatch(/publishDate, createdAt/);
  });

  it('returns null fields (skip-shape) when introspection has no datetime', async () => {
    vi.spyOn(introspectModule, 'introspectContentType').mockResolvedValue({
      ...okIntrospect,
      datetimeFields: [],
    });
    const r = await runPreflight(baseParams);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fields.filterField).toBeNull();
    expect(r.warnings.join('\n')).toMatch(/filtered.*shape.*skipped/i);
  });

  it('errors when k6 is missing', async () => {
    const r = await runPreflight({
      ...baseParams,
      k6Available: async () => false,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join('\n')).toMatch(/k6/);
    expect(r.errors.join('\n')).toMatch(/install/i);
  });

  it('errors when target is unreachable', async () => {
    const r = await runPreflight({
      ...baseParams,
      fetchHealth: async () => ({
        ok: false as const,
        error: 'connection refused',
      }),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join('\n')).toMatch(/connection refused/);
    expect(r.errors.join('\n')).toMatch(/cms.example.com/);
  });
});
