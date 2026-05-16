import { describe, it, expect } from 'vitest';
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';
import type { RateLimitedBody } from '../../utils/rateLimitEndpoint';

// 1x1 red PNG (68 bytes)
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64'
);

function createFormData(
  file: Buffer,
  filename: string,
  mimeType: string,
  fields?: Record<string, string>
) {
  const boundary = '----TestBoundary' + Date.now();
  const parts: Buffer[] = [];

  if (fields) {
    for (const [name, value] of Object.entries(fields)) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
        )
      );
    }
  }

  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    )
  );
  parts.push(file);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

type UploadResponse = {
  storageKey: string;
  mimeType: string;
  width: number;
  height: number;
  fileSize: number;
  originalName: string | null;
};

describe('Files Upload & Transform API', async () => {
  await setup({ dev: true });

  let uploadedStorageKey: string;

  describe('POST /api/files/upload', () => {
    it('returns 400 for missing file', async () => {
      const boundary = '----TestBoundary' + Date.now();
      const body = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="other"\r\n\r\ntest\r\n--${boundary}--\r\n`
      );
      await expect(
        $fetch('/api/files/upload', {
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            Cookie: await getSessionCookie(),
          },
          body,
        })
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('returns 415 for non-image mime', async () => {
      const { body, contentType } = createFormData(
        Buffer.from('not an image'),
        'test.txt',
        'text/plain'
      );
      await expect(
        $fetch('/api/files/upload', {
          method: 'POST',
          headers: {
            'Content-Type': contentType,
            Cookie: await getSessionCookie(),
          },
          body,
        })
      ).rejects.toMatchObject({ statusCode: 415 });
    });

    it('returns 415 for mime/content mismatch (spoofed magic bytes)', async () => {
      const { body, contentType } = createFormData(
        Buffer.from('not an image'),
        'spoof.png',
        'image/png'
      );
      await expect(
        $fetch('/api/files/upload', {
          method: 'POST',
          headers: {
            'Content-Type': contentType,
            Cookie: await getSessionCookie(),
          },
          body,
        })
      ).rejects.toMatchObject({ statusCode: 415 });
    });

    it('returns 413 for file exceeding 5MB', async () => {
      const pngHeader = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      const padding = Buffer.alloc(6 * 1024 * 1024 - pngHeader.length, 0);
      const bigBuffer = Buffer.concat([pngHeader, padding]);
      const { body, contentType } = createFormData(
        bigBuffer,
        'huge.png',
        'image/png'
      );
      await expect(
        $fetch('/api/files/upload', {
          method: 'POST',
          headers: {
            'Content-Type': contentType,
            Cookie: await getSessionCookie(),
          },
          body,
        })
      ).rejects.toMatchObject({ statusCode: 413 });
    });

    it('rejects unauthenticated requests', async () => {
      // CSRF middleware may 403 first, or auth may 401. Accept either.
      const { body, contentType } = createFormData(
        TINY_PNG,
        'test.png',
        'image/png'
      );
      try {
        await $fetch('/api/files/upload', {
          method: 'POST',
          headers: { 'Content-Type': contentType },
          body,
        });
        throw new Error('expected request to be rejected');
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        expect([401, 403]).toContain(status);
      }
    });

    it('uploads a valid PNG and returns primitives', async () => {
      const { body, contentType } = createFormData(
        TINY_PNG,
        'tiny.png',
        'image/png'
      );
      const result = await $fetch<UploadResponse>('/api/files/upload', {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          Cookie: await getSessionCookie(),
        },
        body,
      });

      expect(result.storageKey).toMatch(
        /^[A-Za-z0-9-]+\.(png|webp|jpeg|gif|avif)$/
      );
      expect(result.mimeType).toMatch(/^image\//);
      expect(result.width).toBe(1);
      expect(result.height).toBe(1);
      expect(result.fileSize).toBeGreaterThan(0);
      expect(result.originalName).toBe('tiny.png');

      uploadedStorageKey = result.storageKey;
    });
  });

  describe('GET /api/files/:storageKey/transform', () => {
    it('returns 404 for unknown storage key', async () => {
      await expect(
        $fetch('/api/files/ffffffff-0000.png/transform', {
          responseType: 'arrayBuffer',
        })
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns 400 for malformed storage key (path traversal)', async () => {
      // Encoded so the router accepts it as a single segment.
      // Accept 400 (handler regex rejects) or 404 (router doesn't match).
      const response = await fetch(
        '/api/files/..%2F..%2Fetc%2Fpasswd/transform'
      );
      expect([400, 404]).toContain(response.status);
    });

    it('serves original when no query params', async () => {
      const response = await fetch(
        `/api/files/${uploadedStorageKey}/transform`
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/^image\//);
      expect(response.headers.get('cache-control')).toContain('immutable');
    });

    it('resizes via w=', async () => {
      const response = await fetch(
        `/api/files/${uploadedStorageKey}/transform?w=1`
      );
      expect(response.status).toBe(200);
    });

    it('converts format via f=webp', async () => {
      const response = await fetch(
        `/api/files/${uploadedStorageKey}/transform?f=webp`
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/webp');
    });

    it('is publicly accessible without auth', async () => {
      const response = await fetch(
        `/api/files/${uploadedStorageKey}/transform`
      );
      expect(response.status).toBe(200);
    });

    it('returns 429 when transform rate-limited', async () => {
      // Use a unique simulated IP so this test's budget is isolated from
      // other tests in the suite (the in-process rate limiter is per-IP).
      const testIp = `198.51.100.${Math.floor(Math.random() * 254) + 1}`;
      // The default per-IP cap is 100/60s. Drive 101 real HTTP calls with
      // the same x-forwarded-for so the endpoint's own limiter trips and we
      // can assert on the real 429 response body.
      let limited: Response | undefined;
      for (let i = 0; i < 101; i++) {
        const res = await fetch(`/api/files/${uploadedStorageKey}/transform`, {
          headers: { 'x-forwarded-for': testIp },
        });
        if (res.status === 429) {
          limited = res;
          break;
        }
      }
      expect(limited).toBeDefined();
      expect(limited!.status).toBe(429);
      const body = (await limited!.json()) as { data?: RateLimitedBody };
      expect(body.data?.error).toBe('RATE_LIMITED');
      expect(body.data?.message).toBe('Too many requests');
      expect(body.data?.retryAfter).toBeGreaterThanOrEqual(1);
      expect(body.data?.suggestion).toContain('transform');
      expect(limited!.headers.get('retry-after')).toBeDefined();
    });
  });
});

let _sessionCookie: string;
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
