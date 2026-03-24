import { describe, it, expect } from 'vitest';
import { setup, fetch } from '@nuxt/test-utils/e2e';

let _sessionCookie: string | null = null;

async function getSessionCookie(): Promise<string> {
  if (_sessionCookie) return _sessionCookie;

  const response = await fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'admin@boject.com',
      password: 'password',
    }),
    headers: { 'Content-Type': 'application/json' },
  });

  const cookies = response.headers.getSetCookie();
  _sessionCookie = cookies.join('; ');
  return _sessionCookie;
}

describe('Competition POST endpoint', async () => {
  await setup({ dev: true });

  describe('POST /api/competitions', () => {
    it('creates a competition with valid data', async () => {
      const name = `Test Competition ${Date.now()}`;
      const slug = `test-competition-${Date.now()}`;
      const response = await fetch('/api/competitions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({ name, slug }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe(name);
      expect(body.slug).toBe(slug);
      expect(body.status).toBe('DRAFT');
    });

    it('returns 400 when name is missing', async () => {
      const response = await fetch('/api/competitions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({ slug: 'some-slug' }),
      });

      expect(response.status).toBe(400);
    });

    it('returns 400 when slug is missing', async () => {
      const response = await fetch('/api/competitions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({ name: 'Some Competition' }),
      });

      expect(response.status).toBe(400);
    });

    it('returns 409 for duplicate name or slug', async () => {
      const name = `Dup Competition ${Date.now()}`;
      const slug = `dup-competition-${Date.now()}`;
      const cookie = await getSessionCookie();

      await fetch('/api/competitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ name, slug }),
      });

      const response = await fetch('/api/competitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ name, slug }),
      });

      expect(response.status).toBe(409);
    });
  });
});
