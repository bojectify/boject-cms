import { afterEach, describe, expect, it, vi } from 'vitest';
import { introspectContentType } from './introspect.js';

const FETCH = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = FETCH;
  vi.restoreAllMocks();
});

interface IntrospectField {
  name: string;
  type: {
    kind: string;
    name: string | null;
    ofType?: IntrospectField['type'] | null;
  };
}

function mockResponse(fields: IntrospectField[]): Response {
  const body = JSON.stringify({
    data: {
      __type: { name: 'Article', kind: 'OBJECT', fields },
      __schema: {
        queryType: { fields: [{ name: 'articleList' }, { name: 'article' }] },
      },
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('introspectContentType', () => {
  it('returns list field + datetime + single-target relation fields', async () => {
    globalThis.fetch = vi.fn(async () =>
      mockResponse([
        {
          name: 'id',
          type: {
            kind: 'NON_NULL',
            name: null,
            ofType: { kind: 'SCALAR', name: 'ID' },
          },
        },
        { name: 'publishDate', type: { kind: 'SCALAR', name: 'DateTime' } },
        { name: 'author', type: { kind: 'OBJECT', name: 'Author' } },
        {
          name: 'tags',
          type: {
            kind: 'LIST',
            name: null,
            ofType: { kind: 'OBJECT', name: 'Tag' },
          },
        },
      ])
    ) as typeof fetch;

    const r = await introspectContentType({
      url: 'https://cms.example.com',
      apiKey: 'boject_test',
      contentTypeIdentifier: 'Article',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.listField).toBe('articleList');
    expect(r.datetimeFields).toEqual(['publishDate']);
    expect(r.singleTargetRelationFields).toEqual(['author']);
  });

  it('reports a missing content type with 200 + null __type', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: { __type: null, __schema: { queryType: { fields: [] } } },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    ) as typeof fetch;

    const r = await introspectContentType({
      url: 'https://cms.example.com',
      apiKey: 'boject_test',
      contentTypeIdentifier: 'Nope',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/content type/i);
    expect(r.error).toMatch(/Nope/);
  });

  it('reports auth failure cleanly on 401', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('Unauthorized', { status: 401 })
    ) as typeof fetch;

    const r = await introspectContentType({
      url: 'https://cms.example.com',
      apiKey: 'boject_test',
      contentTypeIdentifier: 'Article',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/api key/i);
  });

  it('reports scope failure cleanly on 403', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('Forbidden', { status: 403 })
    ) as typeof fetch;

    const r = await introspectContentType({
      url: 'https://cms.example.com',
      apiKey: 'boject_test',
      contentTypeIdentifier: 'Article',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/content:read/);
  });
});
