import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listTags,
  parseImageRef,
  pickHighestSemver,
} from '../../src/registry.js';

describe('parseImageRef', () => {
  it('parses registry/repo:tag form', () => {
    expect(parseImageRef('ghcr.io/bojectify/boject-cms:1.2.3')).toEqual({
      registry: 'ghcr.io',
      repository: 'bojectify/boject-cms',
      tag: '1.2.3',
    });
  });

  it('parses host:port/repo:tag', () => {
    expect(parseImageRef('localhost:5555/boject/cms:0.0.1-rc.1')).toEqual({
      registry: 'localhost:5555',
      repository: 'boject/cms',
      tag: '0.0.1-rc.1',
    });
  });

  it('parses multi-segment repository', () => {
    expect(parseImageRef('registry.example.com/team/app/cms:1.0.0')).toEqual({
      registry: 'registry.example.com',
      repository: 'team/app/cms',
      tag: '1.0.0',
    });
  });

  it('throws on missing tag', () => {
    expect(() => parseImageRef('ghcr.io/bojectify/boject-cms')).toThrow(/tag/);
  });

  it('throws on missing registry', () => {
    expect(() => parseImageRef('boject/cms:1.0.0')).toThrow(/registry/);
  });
});

describe('pickHighestSemver', () => {
  it('returns the highest semver, ignoring non-semver tags', () => {
    expect(
      pickHighestSemver(['latest', '1.0.0', '1.2.0', '1.1.5', 'dev', 'main'])
    ).toBe('1.2.0');
  });

  it('handles prerelease ordering correctly', () => {
    expect(pickHighestSemver(['1.2.3-rc.1', '1.2.3', '1.2.3-rc.2'])).toBe(
      '1.2.3'
    );
  });

  it('returns null when no semver tags are present', () => {
    expect(pickHighestSemver(['latest', 'dev', 'main'])).toBeNull();
  });

  it('returns null for an empty input', () => {
    expect(pickHighestSemver([])).toBeNull();
  });
});

describe('listTags', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches tags from /v2/<repo>/tags/list with no auth on 200', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ name: 'boject/cms', tags: ['1.0.0', '1.1.0'] }),
        {
          status: 200,
        }
      )
    );
    const tags = await listTags({
      registry: 'localhost:5555',
      repository: 'boject/cms',
    });
    expect(tags).toEqual(['1.0.0', '1.1.0']);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5555/v2/boject/cms/tags/list',
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it('uses https by default for non-localhost registries', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ name: 'boject/cms', tags: ['1.0.0'] }), {
        status: 200,
      })
    );
    await listTags({ registry: 'ghcr.io', repository: 'boject/cms' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://ghcr.io/v2/boject/cms/tags/list',
      expect.any(Object)
    );
  });

  it('follows the Bearer-token flow on 401', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response('unauthorized', {
          status: 401,
          headers: {
            'www-authenticate':
              'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:boject/cms:pull"',
          },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'tok-1' }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ name: 'boject/cms', tags: ['1.2.3'] }), {
          status: 200,
        })
      );

    const tags = await listTags({
      registry: 'ghcr.io',
      repository: 'boject/cms',
    });
    expect(tags).toEqual(['1.2.3']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://ghcr.io/token?service=ghcr.io&scope=repository%3Aboject%2Fcms%3Apull'
    );
    expect(fetchMock.mock.calls[2][1]?.headers).toMatchObject({
      Authorization: 'Bearer tok-1',
    });
  });

  it('throws a descriptive error on non-200 / non-401 responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response('oops', { status: 500 }));
    await expect(
      listTags({ registry: 'localhost:5555', repository: 'boject/cms' })
    ).rejects.toThrow(/500/);
  });
});
