import { describe, it, expect } from 'vitest';
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';

let _sessionCookie: string | null = null;

async function getSessionCookie(): Promise<string> {
  if (_sessionCookie) return _sessionCookie;

  const response = await fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: TEST_USERNAME,
      password: TEST_PASSWORD,
    }),
    headers: { 'Content-Type': 'application/json' },
  });

  const cookies = response.headers.getSetCookie();
  _sessionCookie = cookies.join('; ');
  return _sessionCookie;
}

describe('Player endpoints', async () => {
  await setup({ dev: true });

  describe('POST /api/players', () => {
    let createdSlug: string;

    it('creates a player with valid data', async () => {
      createdSlug = `test-player-${Date.now()}`;
      const response = await fetch('/api/players', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({
          firstName: 'Test',
          lastName: 'Player',
          slug: createdSlug,
        }),
      });
      expect(response.status).toBe(201);
      const player = await response.json();
      expect(player.id).toBeDefined();
      expect(player.firstName).toBe('Test');
      expect(player.lastName).toBe('Player');
      expect(player.slug).toBe(createdSlug);
      expect(player.status).toBe('DRAFT');
    });

    it('returns 400 when firstName is missing', async () => {
      const err = await $fetch('/api/players', {
        method: 'POST',
        headers: { Cookie: await getSessionCookie() },
        body: { lastName: 'Player', slug: 'missing-first' },
      }).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        400
      );
    });

    it('returns 400 when lastName is missing', async () => {
      const err = await $fetch('/api/players', {
        method: 'POST',
        headers: { Cookie: await getSessionCookie() },
        body: { firstName: 'Test', slug: 'missing-last' },
      }).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        400
      );
    });

    it('returns 400 when slug is missing', async () => {
      const err = await $fetch('/api/players', {
        method: 'POST',
        headers: { Cookie: await getSessionCookie() },
        body: { firstName: 'Test', lastName: 'Player' },
      }).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        400
      );
    });

    it('returns 409 on duplicate slug', async () => {
      const err = await $fetch('/api/players', {
        method: 'POST',
        headers: { Cookie: await getSessionCookie() },
        body: {
          firstName: 'Another',
          lastName: 'Player',
          slug: createdSlug,
        },
      }).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        409
      );
    });
  });
});
