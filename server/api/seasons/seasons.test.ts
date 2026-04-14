import { describe, it, expect } from 'vitest';
import { setup, fetch } from '@nuxt/test-utils/e2e';
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

describe('Season POST endpoint', async () => {
  await setup({ dev: true });

  describe('POST /api/seasons', () => {
    it('creates a season with valid data', async () => {
      const name = `Test Season ${Date.now()}`;
      const slug = `test-season-${Date.now()}`;
      const response = await fetch('/api/seasons', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({
          name,
          slug,
          startDate: '2025-09-01T00:00:00.000Z',
          endDate: '2026-06-30T00:00:00.000Z',
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe(name);
      expect(body.slug).toBe(slug);
      expect(body.status).toBe('DRAFT');
    });

    it('returns 400 when name is missing', async () => {
      const response = await fetch('/api/seasons', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({
          slug: 'some-slug',
          startDate: '2025-09-01T00:00:00.000Z',
          endDate: '2026-06-30T00:00:00.000Z',
        }),
      });

      expect(response.status).toBe(400);
    });

    it('returns 400 when slug is missing', async () => {
      const response = await fetch('/api/seasons', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({
          name: 'Some Season',
          startDate: '2025-09-01T00:00:00.000Z',
          endDate: '2026-06-30T00:00:00.000Z',
        }),
      });

      expect(response.status).toBe(400);
    });

    it('returns 400 when startDate is missing', async () => {
      const response = await fetch('/api/seasons', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({
          name: 'Some Season',
          slug: 'some-season',
          endDate: '2026-06-30T00:00:00.000Z',
        }),
      });

      expect(response.status).toBe(400);
    });

    it('returns 409 for duplicate name or slug', async () => {
      const name = `Dup Season ${Date.now()}`;
      const slug = `dup-season-${Date.now()}`;
      const cookie = await getSessionCookie();

      await fetch('/api/seasons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name,
          slug,
          startDate: '2025-09-01T00:00:00.000Z',
          endDate: '2026-06-30T00:00:00.000Z',
        }),
      });

      const response = await fetch('/api/seasons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name,
          slug,
          startDate: '2025-09-01T00:00:00.000Z',
          endDate: '2026-06-30T00:00:00.000Z',
        }),
      });

      expect(response.status).toBe(409);
    });
  });
});
