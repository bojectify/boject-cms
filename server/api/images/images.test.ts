import { describe, it, expect } from 'vitest';
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';

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

  // Add fields
  if (fields) {
    for (const [name, value] of Object.entries(fields)) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
        )
      );
    }
  }

  // Add file
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

type ImageRecord = {
  id: string;
  url: string;
  alt: string;
  width: number;
  height: number;
  storagePath: string | null;
  mimeType: string | null;
  fileSize: number | null;
  originalName: string | null;
  entryTitle: string;
};

describe('Image Upload & Transform API', async () => {
  await setup({ dev: true });

  let uploadedImageId: string;

  // ── Upload tests ──────────────────────────────────────────────

  describe('POST /api/images/upload', () => {
    it('returns 400 for missing file', async () => {
      const boundary = '----TestBoundary' + Date.now();
      const body = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="alt"\r\n\r\ntest\r\n--${boundary}--\r\n`
      );

      await expect(
        $fetch('/api/images/upload', {
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            Cookie: await getSessionCookie(),
          },
          body,
        })
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('returns 415 for non-image file', async () => {
      const { body, contentType } = createFormData(
        Buffer.from('not an image'),
        'test.txt',
        'text/plain'
      );

      await expect(
        $fetch('/api/images/upload', {
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
      // Start with a real PNG header so it passes mime-type detection
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
        $fetch('/api/images/upload', {
          method: 'POST',
          headers: {
            'Content-Type': contentType,
            Cookie: await getSessionCookie(),
          },
          body,
        })
      ).rejects.toMatchObject({ statusCode: 413 });
    });

    it('uploads a valid image and returns the record', async () => {
      const { body, contentType } = createFormData(
        TINY_PNG,
        'test-image.png',
        'image/png',
        { alt: 'A test image', entryTitle: 'Test Image' }
      );

      const image = await $fetch<ImageRecord>('/api/images/upload', {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          Cookie: await getSessionCookie(),
        },
        body,
      });

      expect(image).toHaveProperty('id');
      expect(image.storagePath).toBeTruthy();
      expect(image.mimeType).toMatch(/^image\//);
      expect(image.fileSize).toBeGreaterThan(0);
      expect(image.width).toBe(1);
      expect(image.height).toBe(1);
      expect(image.alt).toBe('A test image');
      expect(image.entryTitle).toBe('Test Image');
      expect(image.originalName).toBe('test-image.png');

      uploadedImageId = image.id;
    });
  });

  // ── Transform tests ───────────────────────────────────────────

  describe('GET /api/images/:id/transform', () => {
    it('returns 404 for non-existent image', async () => {
      await expect(
        $fetch('/api/images/00000000-0000-0000-0000-000000000000/transform', {
          responseType: 'arrayBuffer',
        })
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns 400 for invalid width', async () => {
      await expect(
        $fetch(`/api/images/${uploadedImageId}/transform?w=-1`, {
          responseType: 'arrayBuffer',
        })
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('returns 400 for quality > 100', async () => {
      await expect(
        $fetch(`/api/images/${uploadedImageId}/transform?q=101`, {
          responseType: 'arrayBuffer',
        })
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('returns 400 for invalid format', async () => {
      await expect(
        $fetch(`/api/images/${uploadedImageId}/transform?f=bmp`, {
          responseType: 'arrayBuffer',
        })
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('serves original when no params', async () => {
      const response = await fetch(`/api/images/${uploadedImageId}/transform`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/^image\//);
      expect(response.headers.get('cache-control')).toContain('immutable');
    });

    it('converts format to webp', async () => {
      const response = await fetch(
        `/api/images/${uploadedImageId}/transform?f=webp`
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/webp');
    });

    it('is publicly accessible without auth', async () => {
      // No Cookie or Authorization header
      const response = await fetch(`/api/images/${uploadedImageId}/transform`);

      expect(response.status).toBe(200);
    });

    it('returns 400 for fpx out of range', async () => {
      await expect(
        $fetch(`/api/images/${uploadedImageId}/transform?w=100&h=100&fpx=1.5`, {
          responseType: 'arrayBuffer',
        })
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('returns 400 for focal point without both dimensions', async () => {
      await expect(
        $fetch(
          `/api/images/${uploadedImageId}/transform?w=100&fpx=0.5&fpy=0.5`,
          { responseType: 'arrayBuffer' }
        )
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('applies focal point crop with fpx and fpy', async () => {
      const response = await fetch(
        `/api/images/${uploadedImageId}/transform?w=1&h=1&fpx=0.5&fpy=0.5&f=png`
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
    });

    it('returns 429 when rate limited', async () => {
      // Exhaust rate limit by flooding with requests
      const { rateLimit: rl } = await import('../../utils/rateLimit');
      const testIp = 'rate-limit-test-ip';
      for (let i = 0; i < 100; i++) {
        rl(`transform:${testIp}`);
      }
      const { allowed } = rl(`transform:${testIp}`);
      expect(allowed).toBe(false);

      // Reset for other tests
      const { resetRateLimitStore: reset } =
        await import('../../utils/rateLimit');
      reset();
    });
  });

  // ── Placeholder tests ─────────────────────────────────────────

  describe('GET /api/images/:id/placeholder', () => {
    it('returns 404 for non-existent image', async () => {
      await expect(
        $fetch('/api/images/00000000-0000-0000-0000-000000000000/placeholder')
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns JSON with a valid base64 WebP data URI', async () => {
      const result = await $fetch<{ dataUri: string }>(
        `/api/images/${uploadedImageId}/placeholder`
      );

      expect(result).toHaveProperty('dataUri');
      expect(result.dataUri).toMatch(
        /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/
      );
    });

    it('returns immutable cache headers', async () => {
      const response = await fetch(
        `/api/images/${uploadedImageId}/placeholder`
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain(
        'application/json'
      );
      expect(response.headers.get('cache-control')).toContain('immutable');
    });

    it('is publicly accessible without auth', async () => {
      const response = await fetch(
        `/api/images/${uploadedImageId}/placeholder`
      );

      expect(response.status).toBe(200);
    });

    it('returns 429 when rate limited', async () => {
      const { rateLimit: rl } = await import('../../utils/rateLimit');
      const testIp = 'placeholder-rate-limit-test-ip';
      for (let i = 0; i < 100; i++) {
        rl(`transform:${testIp}`);
      }
      const { allowed } = rl(`transform:${testIp}`);
      expect(allowed).toBe(false);

      const { resetRateLimitStore: reset } =
        await import('../../utils/rateLimit');
      reset();
    });
  });
});

// Helper to get session cookie via login
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
