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

  it('reports both override errors when both are invalid', async () => {
    vi.spyOn(introspectModule, 'introspectContentType').mockResolvedValue(
      okIntrospect
    );
    const r = await runPreflight({
      ...baseParams,
      filterFieldOverride: 'nope',
      relationFieldOverride: 'alsoNope',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toHaveLength(2);
    expect(r.errors.join('\n')).toMatch(/--filter-field/);
    expect(r.errors.join('\n')).toMatch(/--relation-field/);
  });

  it('returns introspection error when introspect fails', async () => {
    vi.spyOn(introspectModule, 'introspectContentType').mockResolvedValue({
      ok: false,
      error: 'Type "Bogus" not found',
    });
    const r = await runPreflight({
      ...baseParams,
      contentTypeIdentifier: 'Bogus',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual(['Type "Bogus" not found']);
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

  it('does not invoke the content:write probe when requireContentWrite is false', async () => {
    vi.spyOn(introspectModule, 'introspectContentType').mockResolvedValue(
      okIntrospect
    );
    const probeSpy = vi.fn(async () => ({ ok: true as const }));
    const r = await runPreflight({
      ...baseParams,
      probeContentWrite: probeSpy,
    });
    expect(r.ok).toBe(true);
    expect(probeSpy).not.toHaveBeenCalled();
  });

  it('passes when requireContentWrite is true and the probe reports ok', async () => {
    vi.spyOn(introspectModule, 'introspectContentType').mockResolvedValue(
      okIntrospect
    );
    const probeSpy = vi.fn(async () => ({ ok: true as const }));
    const r = await runPreflight({
      ...baseParams,
      requireContentWrite: true,
      probeContentWrite: probeSpy,
    });
    expect(r.ok).toBe(true);
    expect(probeSpy).toHaveBeenCalledTimes(1);
    expect(probeSpy).toHaveBeenCalledWith({
      baseUrl: baseParams.url,
      apiKey: baseParams.apiKey,
    });
  });

  it('fails with the actionable mint hint when the probe reports missing scope', async () => {
    vi.spyOn(introspectModule, 'introspectContentType').mockResolvedValue(
      okIntrospect
    );
    const probeSpy = vi.fn(async () => ({
      ok: false as const,
      missingScope: 'content:write' as const,
    }));
    const r = await runPreflight({
      ...baseParams,
      requireContentWrite: true,
      probeContentWrite: probeSpy,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const joined = r.errors.join('\n');
    expect(joined).toContain('API key missing required scope "content:write"');
    expect(joined).toContain(
      'boject apikey create --scopes content:write,content:read'
    );
  });

  it('fails with an indeterminate error when the probe cannot verify', async () => {
    vi.spyOn(introspectModule, 'introspectContentType').mockResolvedValue(
      okIntrospect
    );
    const probeSpy = vi.fn(async () => ({
      ok: false as const,
      error: 'rate limited by CMS — wait 60s and retry',
    }));
    const r = await runPreflight({
      ...baseParams,
      requireContentWrite: true,
      probeContentWrite: probeSpy,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join('\n')).toContain(
      'Could not verify content:write scope: rate limited by CMS — wait 60s and retry'
    );
  });

  it('does not invoke the probe when introspection fails', async () => {
    vi.spyOn(introspectModule, 'introspectContentType').mockResolvedValue({
      ok: false,
      error: 'Type "Bogus" not found',
    });
    const probeSpy = vi.fn(async () => ({ ok: true as const }));
    const r = await runPreflight({
      ...baseParams,
      contentTypeIdentifier: 'Bogus',
      requireContentWrite: true,
      probeContentWrite: probeSpy,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual(['Type "Bogus" not found']);
    expect(probeSpy).not.toHaveBeenCalled();
  });
});
