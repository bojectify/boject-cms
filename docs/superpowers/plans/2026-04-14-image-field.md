# IMAGE Field Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `IMAGE` field type to the dynamic content type system, plus decoupled file-upload and transform endpoints that operate on storage keys.

**Architecture:** New `IMAGE` enum value + JSONB shape for content-entry `data`. Upload endpoint at `POST /api/files/upload` writes to shared `images:originals` unstorage bucket and returns storage primitives. Transform endpoint at `GET /api/files/:storageKey/transform` is public, reads directly by storage key (no DB lookup). Editor UI renders a minimal upload/preview/remove component. Legacy `/api/images/*` pipeline is untouched and coexists.

**Tech Stack:** TypeScript, Prisma v7 + `@prisma/adapter-pg`, Nuxt 4 / Nitro, Vitest + `@nuxt/test-utils`, Sharp, Nitro unstorage, Vue 3 + Nuxt UI.

**Reference spec:** `docs/superpowers/specs/2026-04-14-image-field-design.md`

---

## Task 1: Add IMAGE to `FieldType` enum

**Files:**

- Modify: `prisma/schema/contentType.prisma`
- Create: `prisma/migrations/20260415120000_add_image_field_type/migration.sql`

**Context:** Prisma v7 multi-file schema + Postgres. Adding an enum value requires a migration. In this project `prisma migrate dev` requires an interactive terminal and fails via MCP/non-interactive contexts — hand-write the SQL, then apply with `pnpx prisma migrate deploy`. Use `pnpx`, not `npx`.

- [ ] **Step 1: Update the Prisma schema**

Replace the `FieldType` enum at the top of `prisma/schema/contentType.prisma`:

```prisma
enum FieldType {
  ENTRY_TITLE
  SLUG
  TEXT
  TEXTAREA
  NUMBER
  BOOLEAN
  DATETIME
  SELECT
  RICHTEXT
  RELATION
  MULTIRELATION
  IMAGE
}
```

- [ ] **Step 2: Create the migration SQL**

Create `prisma/migrations/20260415120000_add_image_field_type/migration.sql` with:

```sql
-- AlterEnum
ALTER TYPE "FieldType" ADD VALUE 'IMAGE';
```

- [ ] **Step 3: Apply migration to dev DB**

Run: `pnpx prisma migrate deploy`

Expected: `Applying migration 20260415120000_add_image_field_type` followed by `1 migration applied`.

- [ ] **Step 4: Apply migration to test DB**

Run: `DATABASE_URL=postgresql://boject:boject@localhost:5432/boject_test pnpx prisma migrate deploy`

Expected: same applied output.

- [ ] **Step 5: Regenerate Prisma client**

Run: `pnpm prisma:generate`

Expected: `Generated Prisma Client` succeeded. The generated `FieldType` union type now includes `'IMAGE'`.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema/contentType.prisma prisma/migrations/20260415120000_add_image_field_type/
git commit -m "feat(schema): add IMAGE to FieldType enum"
```

---

## Task 2: `validateEntryData` — add IMAGE case

**Files:**

- Modify: `server/utils/validateEntryData.ts`
- Create: `server/utils/validateEntryData.test.ts` (unit tests — file may not exist yet)

**Context:** `validateEntryData` in `server/utils/validateEntryData.ts` has a switch on `field.type` that handles every `FieldType` enum value. Adding IMAGE means a new case that does pure shape validation — no DB side-effects. Unknown keys in the input object are dropped; only validated keys are returned.

- [ ] **Step 1: Write the failing unit tests**

Create `server/utils/validateEntryData.test.ts` if it doesn't exist, otherwise add these cases to the existing `describe` block. Full file contents (replace or create):

```ts
import { describe, expect, it } from 'vitest';
import { validateEntryData } from './validateEntryData';

const imageField = {
  identifier: 'hero',
  name: 'Hero',
  type: 'IMAGE' as const,
  required: true,
  options: null,
};

const fullImage = {
  storageKey: 'abc123.webp',
  mimeType: 'image/webp',
  width: 1600,
  height: 900,
  fileSize: 123456,
  originalName: 'sunset.jpg',
  focalPointX: 0.3,
  focalPointY: 0.7,
};

describe('validateEntryData — IMAGE', () => {
  it('accepts a valid full IMAGE value', async () => {
    const result = await validateEntryData({ hero: fullImage }, [imageField]);
    expect(result.hero).toEqual(fullImage);
  });

  it('defaults focalPointX/Y to 0.5 when omitted', async () => {
    const { focalPointX, focalPointY, ...rest } = fullImage;
    const result = await validateEntryData({ hero: rest }, [imageField]);
    expect(result.hero).toMatchObject({
      focalPointX: 0.5,
      focalPointY: 0.5,
    });
  });

  it('accepts null originalName', async () => {
    const result = await validateEntryData(
      { hero: { ...fullImage, originalName: null } },
      [imageField]
    );
    expect((result.hero as Record<string, unknown>).originalName).toBeNull();
  });

  it('clamps out-of-range focalPointX to 0.5', async () => {
    const result = await validateEntryData(
      { hero: { ...fullImage, focalPointX: 1.5 } },
      [imageField]
    );
    expect((result.hero as Record<string, unknown>).focalPointX).toBe(0.5);
  });

  it('rejects missing storageKey with 400', async () => {
    const { storageKey: _drop, ...partial } = fullImage;
    await expect(
      validateEntryData({ hero: partial }, [imageField])
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects non-numeric width with 400', async () => {
    await expect(
      validateEntryData({ hero: { ...fullImage, width: 'wide' } }, [imageField])
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects null when required', async () => {
    await expect(
      validateEntryData({ hero: null }, [imageField])
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('allows null when optional', async () => {
    const result = await validateEntryData({ hero: null }, [
      { ...imageField, required: false },
    ]);
    expect(result.hero).toBeNull();
  });

  it('drops unknown keys from the input object', async () => {
    const result = await validateEntryData(
      { hero: { ...fullImage, junk: 'ignored' } },
      [imageField]
    );
    expect(result.hero).not.toHaveProperty('junk');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test server/utils/validateEntryData.test.ts`

Expected: All 9 new tests fail — either because the switch has no `IMAGE` case (falls through to the `default`), or the generated `FieldType` type already lists `IMAGE` but the switch doesn't know it.

- [ ] **Step 3: Add the IMAGE case**

Open `server/utils/validateEntryData.ts`. After the `MULTIRELATION` case and before `default:`, insert:

```ts
case 'IMAGE': {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field.name} must be an object`,
    });
  }
  const img = value as Record<string, unknown>;

  if (typeof img.storageKey !== 'string' || !img.storageKey) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field.name} must have a storageKey`,
    });
  }
  if (typeof img.mimeType !== 'string' || !img.mimeType) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field.name} must have a mimeType`,
    });
  }
  if (typeof img.width !== 'number' || !Number.isFinite(img.width)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field.name} must have a numeric width`,
    });
  }
  if (typeof img.height !== 'number' || !Number.isFinite(img.height)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field.name} must have a numeric height`,
    });
  }
  if (typeof img.fileSize !== 'number' || !Number.isFinite(img.fileSize)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field.name} must have a numeric fileSize`,
    });
  }

  const originalName =
    typeof img.originalName === 'string' ? img.originalName : null;
  const focalPointX =
    typeof img.focalPointX === 'number' &&
    img.focalPointX >= 0 &&
    img.focalPointX <= 1
      ? img.focalPointX
      : 0.5;
  const focalPointY =
    typeof img.focalPointY === 'number' &&
    img.focalPointY >= 0 &&
    img.focalPointY <= 1
      ? img.focalPointY
      : 0.5;

  validated[field.identifier] = {
    storageKey: img.storageKey,
    mimeType: img.mimeType,
    width: img.width,
    height: img.height,
    fileSize: img.fileSize,
    originalName,
    focalPointX,
    focalPointY,
  };
  break;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test server/utils/validateEntryData.test.ts`

Expected: 9 passed.

- [ ] **Step 5: Regression — existing content entry tests still pass**

Run: `pnpm test server/api/content-entries/content-entries.test.ts`

Expected: All existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/utils/validateEntryData.ts server/utils/validateEntryData.test.ts
git commit -m "feat(validation): add IMAGE case to validateEntryData"
```

---

## Task 3: `POST /api/files/upload` — primitive file upload endpoint

**Files:**

- Create: `server/api/files/upload.post.ts`
- (Test file in Task 5)

**Context:** Similar to `server/api/images/upload.post.ts` but does NOT create any DB row. Returns storage primitives only. Reuses `processOriginal`, `ALLOWED_MIME_TYPES`, `IMAGE_UPLOAD_MAX_SIZE` from `server/utils/imageProcessing.ts`. Auth is handled by the global `server/middleware/auth.ts` — session cookie required; API-key requests are blocked because `auth.ts` enforces read-only for API keys on non-GET methods. Unstorage bucket: `useStorage('images:originals')`, shared with legacy. Nuxt auto-imports `readMultipartFormData`, `createError`, `defineEventHandler`, `setResponseStatus`, `useStorage` — no explicit import needed.

- [ ] **Step 1: Create the endpoint**

Create `server/api/files/upload.post.ts`:

```ts
import crypto from 'node:crypto';
import {
  IMAGE_UPLOAD_MAX_SIZE,
  ALLOWED_MIME_TYPES,
  processOriginal,
} from '../../utils/imageProcessing';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';

const MAGIC_BYTES: Record<string, number[]> = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/webp': [0x52, 0x49, 0x46, 0x46], // RIFF
  'image/gif': [0x47, 0x49, 0x46], // GIF
};

export default defineEventHandler(async (event) => {
  enforceMutationRateLimit(event, 'files.upload');

  const formData = await readMultipartFormData(event);
  if (!formData) {
    throw createError({
      statusCode: 400,
      message: 'Missing multipart form data',
    });
  }

  const filePart = formData.find((part) => part.name === 'file');
  if (!filePart || !filePart.data || !filePart.type) {
    throw createError({ statusCode: 400, message: 'Missing file in upload' });
  }

  if (!ALLOWED_MIME_TYPES.has(filePart.type)) {
    throw createError({
      statusCode: 415,
      message: `Unsupported media type: ${filePart.type}`,
    });
  }

  const expected = MAGIC_BYTES[filePart.type];
  if (expected) {
    const header = filePart.data.slice(0, expected.length);
    if (!expected.every((byte, i) => header[i] === byte)) {
      throw createError({
        statusCode: 415,
        message: 'File content does not match declared type',
      });
    }
  }

  if (filePart.data.length > IMAGE_UPLOAD_MAX_SIZE) {
    throw createError({
      statusCode: 413,
      message: `File too large. Maximum size is ${IMAGE_UPLOAD_MAX_SIZE / 1024 / 1024}MB`,
    });
  }

  const processed = await processOriginal(Buffer.from(filePart.data));
  const storageKey = `${crypto.randomUUID()}.${processed.format}`;

  const storage = useStorage('images:originals');
  await storage.setItemRaw(storageKey, processed.data);

  setResponseStatus(event, 201);
  return {
    storageKey,
    mimeType: `image/${processed.format}`,
    width: processed.width,
    height: processed.height,
    fileSize: processed.data.length,
    originalName: filePart.filename ?? null,
  };
});
```

- [ ] **Step 2: Smoke typecheck**

Run: `pnpm typecheck`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add server/api/files/upload.post.ts
git commit -m "feat(files): add POST /api/files/upload primitive upload endpoint"
```

---

## Task 4: `GET /api/files/:storageKey/transform` — public transform endpoint

**Files:**

- Create: `server/api/files/[storageKey]/transform.get.ts`
- Modify: `server/middleware/auth.ts`

**Context:** Similar logic to `server/api/images/[id]/transform.get.ts` but looks up the file by storage key directly (no Prisma `Image` row lookup). Must be added to the global auth middleware's public-route allow-list. `rateLimit('transform:${ip}')` limit is 100 req / 60s, shared with the legacy transform. Uses `getRouterParam`, `getRequestHeader`, `getRequestIP`, `getQuery`, `useStorage`, `setHeader`, `send`, `createError`, `defineEventHandler` — most are Nuxt/h3 auto-imports.

- [ ] **Step 1: Allow the new route in auth middleware**

Open `server/middleware/auth.ts`. The early-return block currently has two image-path regex checks. Replace:

```ts
// Skip auth-related routes, GraphQL (has its own API key gate), and public image endpoints
if (
  path.startsWith('/api/auth/') ||
  path.startsWith('/api/_auth/') ||
  path.startsWith('/api/graphql') ||
  /^\/api\/images\/[^/]+\/transform$/.test(path) ||
  /^\/api\/images\/[^/]+\/placeholder$/.test(path)
) {
  return;
}
```

With:

```ts
// Skip auth-related routes, GraphQL (has its own API key gate), and public image endpoints
if (
  path.startsWith('/api/auth/') ||
  path.startsWith('/api/_auth/') ||
  path.startsWith('/api/graphql') ||
  /^\/api\/images\/[^/]+\/transform$/.test(path) ||
  /^\/api\/images\/[^/]+\/placeholder$/.test(path) ||
  /^\/api\/files\/[^/]+\/transform$/.test(path)
) {
  return;
}
```

- [ ] **Step 2: Create the transform endpoint**

Create `server/api/files/[storageKey]/transform.get.ts`:

```ts
import { send, setHeader } from 'h3';
import {
  ALLOWED_TRANSFORM_FORMATS,
  ALLOWED_FIT_VALUES,
  transformImage,
} from '../../../utils/imageProcessing';
import { rateLimit } from '../../../utils/rateLimit';

const STORAGE_KEY_PATTERN = /^[A-Za-z0-9-]+\.(jpeg|jpg|png|webp|gif|avif)$/;

export default defineEventHandler(async (event) => {
  const ip =
    getRequestHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() ||
    getRequestIP(event) ||
    'unknown';
  const { allowed, retryAfterMs } = rateLimit(`transform:${ip}`);
  if (!allowed) {
    setHeader(event, 'Retry-After', Math.ceil(retryAfterMs / 1000));
    throw createError({ statusCode: 429, message: 'Too many requests' });
  }

  const storageKey = getRouterParam(event, 'storageKey');
  if (!storageKey || !STORAGE_KEY_PATTERN.test(storageKey)) {
    throw createError({ statusCode: 400, message: 'Invalid storage key' });
  }

  const query = getQuery(event);
  const w = query.w ? Number(query.w) : undefined;
  const h = query.h ? Number(query.h) : undefined;
  const f = query.f ? String(query.f) : undefined;
  const q = query.q ? Number(query.q) : undefined;
  const fit = query.fit ? String(query.fit) : undefined;
  const fpx = query.fpx ? Number(query.fpx) : undefined;
  const fpy = query.fpy ? Number(query.fpy) : undefined;

  if (w !== undefined && (isNaN(w) || w <= 0 || w > 4000)) {
    throw createError({ statusCode: 400, message: 'Invalid width parameter' });
  }
  if (h !== undefined && (isNaN(h) || h <= 0 || h > 4000)) {
    throw createError({ statusCode: 400, message: 'Invalid height parameter' });
  }
  if (f !== undefined && !ALLOWED_TRANSFORM_FORMATS.has(f)) {
    throw createError({
      statusCode: 400,
      message: `Invalid format. Allowed: ${[...ALLOWED_TRANSFORM_FORMATS].join(', ')}`,
    });
  }
  if (q !== undefined && (isNaN(q) || q < 1 || q > 100)) {
    throw createError({
      statusCode: 400,
      message: 'Invalid quality parameter (1-100)',
    });
  }
  if (fit !== undefined && !ALLOWED_FIT_VALUES.has(fit)) {
    throw createError({
      statusCode: 400,
      message: `Invalid fit value. Allowed: ${[...ALLOWED_FIT_VALUES].join(', ')}`,
    });
  }
  if (fpx !== undefined && (isNaN(fpx) || fpx < 0 || fpx > 1)) {
    throw createError({
      statusCode: 400,
      message: 'Invalid fpx parameter (0-1)',
    });
  }
  if (fpy !== undefined && (isNaN(fpy) || fpy < 0 || fpy > 1)) {
    throw createError({
      statusCode: 400,
      message: 'Invalid fpy parameter (0-1)',
    });
  }
  if ((fpx !== undefined || fpy !== undefined) && (!w || !h)) {
    throw createError({
      statusCode: 400,
      message: 'Focal point requires both w and h parameters',
    });
  }

  const originalsStorage = useStorage('images:originals');
  const originalBuffer = await originalsStorage.getItemRaw<Buffer>(storageKey);
  if (!originalBuffer) {
    throw createError({ statusCode: 404, message: 'File not found' });
  }

  const extMatch = storageKey.match(/\.([^.]+)$/);
  const originalFormat = extMatch ? extMatch[1] : 'webp';
  const originalMime = `image/${originalFormat === 'jpg' ? 'jpeg' : originalFormat}`;

  const hasTransformParams = w || h || f || q || fit || fpx || fpy;
  if (!hasTransformParams) {
    setHeader(event, 'Content-Type', originalMime);
    setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable');
    return send(event, Buffer.from(originalBuffer));
  }

  const cacheKey = `files/${storageKey}/${w ?? '_'}_${h ?? '_'}_${f ?? '_'}_${q ?? '_'}_${fit ?? '_'}_${fpx ?? '_'}_${fpy ?? '_'}`;
  const transformsStorage = useStorage('images:transforms');

  const cached = await transformsStorage.getItemRaw<Buffer>(cacheKey);
  if (cached) {
    const contentType = f ? `image/${f}` : originalMime;
    setHeader(event, 'Content-Type', contentType);
    setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable');
    return send(event, Buffer.from(cached));
  }

  const { data, contentType } = await transformImage(
    Buffer.from(originalBuffer),
    { w, h, f, q, fit, fpx, fpy }
  );

  await transformsStorage.setItemRaw(cacheKey, data);

  setHeader(event, 'Content-Type', contentType);
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable');
  return send(event, data);
});
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add server/api/files/[storageKey]/transform.get.ts server/middleware/auth.ts
git commit -m "feat(files): add GET /api/files/:storageKey/transform endpoint"
```

---

## Task 5: Integration tests for the new file endpoints

**Files:**

- Create: `server/api/files/files.test.ts`

**Context:** Integration tests using `@nuxt/test-utils` with `setup({ dev: true })`. Mirrors `server/api/images/images.test.ts`. Uses `TEST_USERNAME` / `TEST_PASSWORD` from `server/test/credentials.ts` for session auth. The `TINY_PNG` constant and `createFormData` helper are identical to the legacy file; copy them over. Vitest project config already picks up `server/**/*.test.ts`.

- [ ] **Step 1: Write the test file**

Create `server/api/files/files.test.ts`:

```ts
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
      // Encoded so the router accepts it as a single segment
      await expect(
        fetch('/api/files/..%2F..%2Fetc%2Fpasswd/transform').then((r) => {
          if (!r.ok) throw { statusCode: r.status };
          return r;
        })
      ).rejects.toMatchObject({ statusCode: 400 });
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
      const { rateLimit: rl, resetRateLimitStore: reset } =
        await import('../../utils/rateLimit');
      const testIp = 'files-transform-rate-limit-ip';
      for (let i = 0; i < 100; i++) rl(`transform:${testIp}`);
      const { allowed } = rl(`transform:${testIp}`);
      expect(allowed).toBe(false);
      reset();
    });
  });

  describe('shared bucket sanity', () => {
    it('legacy /api/images/:id/transform cannot serve a storageKey', async () => {
      // Legacy endpoint looks up by Image row ID, not storage key — so calling it
      // with our primitive storage key must 404 (no DB row exists for it).
      await expect(
        $fetch(`/api/images/${uploadedStorageKey}/transform`, {
          responseType: 'arrayBuffer',
        })
      ).rejects.toMatchObject({ statusCode: 404 });
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
```

- [ ] **Step 2: Run the tests**

Run: `pnpm test server/api/files/files.test.ts`

Expected: All tests pass. (The rate-limit test directly imports and calls `rateLimit`, not the HTTP endpoint — that's the existing pattern from `images.test.ts`.)

- [ ] **Step 3: Regression — full test suite still passes**

Run: `pnpm test`

Expected: Entire suite green (includes auth/legacy image tests).

- [ ] **Step 4: Commit**

```bash
git add server/api/files/files.test.ts
git commit -m "test(files): integration tests for file upload + transform"
```

---

## Task 6: Editor types — add `ImageFieldConfig`

**Files:**

- Modify: `types/contentEditor.ts`

**Context:** The `FieldConfig` union in `types/contentEditor.ts` uses lowercase `kind` strings (`'text'`, `'richtext'`, `'dynamic-relation'`, etc.). Add `'image'` as a new variant.

- [ ] **Step 1: Add `ImageFieldConfig` to the discriminated union**

Open `types/contentEditor.ts`. After `DynamicMultirelationFieldConfig` but before the `FieldConfig` union, add:

```ts
export interface ImageFieldConfig {
  type: 'image';
  key: string;
  label: string;
  required?: boolean;
}
```

Update the `FieldConfig` union to include it:

```ts
export type FieldConfig =
  | TextFieldConfig
  | TextareaFieldConfig
  | NumberFieldConfig
  | BooleanFieldConfig
  | DatetimeFieldConfig
  | SelectFieldConfig
  | RelationFieldConfig
  | RichtextFieldConfig
  | MultirelationFieldConfig
  | DynamicRelationFieldConfig
  | DynamicMultirelationFieldConfig
  | ImageFieldConfig;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add types/contentEditor.ts
git commit -m "feat(types): add ImageFieldConfig to FieldConfig union"
```

---

## Task 7: `ImageField.vue` component

**Files:**

- Create: `components/ImageField.vue`

**Context:** Minimal upload + preview + remove component. Uses `$fetch` for upload. Nuxt UI components (`UButton`) are available. The preview renders via the new transform endpoint. File input is a native `<input type="file">` since that's the minimum-viable UX. Focal point defaults to 0.5 / 0.5 and isn't editable in v1.

- [ ] **Step 1: Create the component**

Create `components/ImageField.vue`:

```vue
<script setup lang="ts">
import type { ImageFieldConfig } from '~/types/contentEditor';

export interface ImageFieldValue {
  storageKey: string;
  mimeType: string;
  width: number;
  height: number;
  fileSize: number;
  originalName: string | null;
  focalPointX: number;
  focalPointY: number;
}

const props = defineProps<{
  modelValue: ImageFieldValue | null;
  field: ImageFieldConfig;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: ImageFieldValue | null];
}>();

const uploading = ref(false);
const errorMessage = ref<string | null>(null);

async function onFileChange(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  errorMessage.value = null;
  uploading.value = true;

  try {
    const form = new FormData();
    form.append('file', file);
    const response = await $fetch<{
      storageKey: string;
      mimeType: string;
      width: number;
      height: number;
      fileSize: number;
      originalName: string | null;
    }>('/api/files/upload', {
      method: 'POST',
      body: form,
    });

    emit('update:modelValue', {
      ...response,
      focalPointX: 0.5,
      focalPointY: 0.5,
    });
  } catch (err: unknown) {
    const msg =
      typeof err === 'object' && err !== null && 'data' in err
        ? // @ts-expect-error — nitro error shape
          (err.data?.message ?? String(err))
        : String(err);
    errorMessage.value = msg;
  } finally {
    uploading.value = false;
    // Clear the input so picking the same file again re-triggers change
    target.value = '';
  }
}

function onRemove() {
  emit('update:modelValue', null);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
</script>

<template>
  <div class="space-y-2">
    <label class="block text-sm font-medium">
      {{ field.label }}
      <span v-if="field.required" class="text-red-500">*</span>
    </label>

    <div v-if="modelValue" class="flex items-start gap-4">
      <img
        :src="`/api/files/${modelValue.storageKey}/transform?w=400`"
        :alt="modelValue.originalName ?? ''"
        class="max-w-[200px] rounded border"
      />
      <div class="text-sm text-gray-600 space-y-1">
        <div>{{ modelValue.width }} × {{ modelValue.height }}</div>
        <div>{{ formatBytes(modelValue.fileSize) }}</div>
        <div v-if="modelValue.originalName">{{ modelValue.originalName }}</div>
        <UButton size="xs" color="red" variant="soft" @click="onRemove">
          Remove
        </UButton>
      </div>
    </div>

    <div v-else>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        :disabled="uploading"
        @change="onFileChange"
      />
      <p v-if="uploading" class="text-sm text-gray-500 mt-1">Uploading…</p>
    </div>

    <p v-if="errorMessage" class="text-sm text-red-600">{{ errorMessage }}</p>
  </div>
</template>
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add components/ImageField.vue
git commit -m "feat(ui): add ImageField component for upload + preview + remove"
```

---

## Task 8: Wire IMAGE into `ContentEditor.vue`

**Files:**

- Modify: `components/ContentEditor.vue`

**Context:** `ContentEditor.vue` switches on `field.type` to render the appropriate input for each field. Add an IMAGE branch that renders `ImageField`. Nuxt auto-imports components from `components/`, so no explicit import needed.

- [ ] **Step 1: Locate the field-type switch**

Open `components/ContentEditor.vue`. Find the `<template>` block that conditionally renders per field type — look for `v-if="field.type === 'richtext'"` or similar.

- [ ] **Step 2: Add the IMAGE branch**

In the same chain of `v-if` / `v-else-if` used for other field types (e.g. RICHTEXT, dynamic-relation), add:

```vue
<template v-else-if="field.type === 'image'">
  <ImageField :field="field" v-model="state[field.key]" />
</template>
```

Place it in a sensible position — near the existing richtext/dynamic-relation branches.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add components/ContentEditor.vue
git commit -m "feat(ui): wire IMAGE field into ContentEditor"
```

---

## Task 9: Map `IMAGE` FieldType → `image` FieldConfig in entry editor pages

**Files:**

- Modify: `pages/content-types/[id]/entries/new.vue`
- Modify: `pages/content-types/[id]/entries/[entryId].vue`

**Context:** Both pages contain a helper that converts `ContentTypeField` records (with `type: FieldType` upper-case enum) into `FieldConfig` (lower-case `type` kind). Currently handles `TEXT`, `TEXTAREA`, `NUMBER`, `BOOLEAN`, `DATETIME`, `SELECT`, `RICHTEXT`, `RELATION`, `MULTIRELATION`. Add `IMAGE`.

- [ ] **Step 1: Update `new.vue`**

Open `pages/content-types/[id]/entries/new.vue`. Find the switch statement mapping `field.type` to `FieldConfig`. After the `'MULTIRELATION'` case and before `default:`, add:

```ts
case 'IMAGE':
  return {
    type: 'image' as const,
    key: field.identifier,
    label: field.name,
    required: field.required,
  };
```

- [ ] **Step 2: Update `[entryId].vue`**

Open `pages/content-types/[id]/entries/[entryId].vue`. Find the same switch and add the same `'IMAGE'` case in the same position.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add pages/content-types/[id]/entries/new.vue pages/content-types/[id]/entries/[entryId].vue
git commit -m "feat(ui): map IMAGE FieldType to image FieldConfig in entry pages"
```

---

## Task 10: End-to-end integration test — IMAGE field on a dynamic content entry

**Files:**

- Modify: `server/api/content-entries/content-entries.test.ts`

**Context:** The existing test file creates a `ContentType` fixture with a handful of fields. Add a new `describe` block (or new tests inside an existing one) that creates a content type with an IMAGE field, then creates/reads/updates/clears an entry against it. Uses the same `testContentType` setup idiom as existing tests — find that pattern and adapt.

- [ ] **Step 1: Understand the existing test setup**

Read `server/api/content-entries/content-entries.test.ts`. Note how it creates content types (via direct Prisma or via API), how it authenticates (`getSessionCookie()` or similar), and how it asserts entry shape. You need to add tests matching this style.

- [ ] **Step 2: Add the IMAGE end-to-end tests**

At the end of the top-level `describe` block in `server/api/content-entries/content-entries.test.ts`, add:

```ts
describe('IMAGE field end-to-end', () => {
  const sampleImage = {
    storageKey: 'e2e-test.webp',
    mimeType: 'image/webp',
    width: 800,
    height: 600,
    fileSize: 50000,
    originalName: 'e2e.jpg',
    focalPointX: 0.25,
    focalPointY: 0.75,
  };

  let imageTypeId: string;

  it('creates a content type with an IMAGE field', async () => {
    const created = await $fetch<{
      id: string;
      fields: { identifier: string; type: string }[];
    }>('/api/content-types', {
      method: 'POST',
      headers: { Cookie: await getSessionCookie() },
      body: {
        name: `HasImage_${Date.now()}`,
        description: null,
        fields: [
          {
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
            order: 0,
          },
          {
            identifier: 'hero',
            name: 'Hero',
            type: 'IMAGE',
            required: false,
            order: 1,
          },
        ],
      },
    });

    expect(created.fields.some((f) => f.type === 'IMAGE')).toBe(true);
    imageTypeId = created.id;
  });

  let entryId: string;

  it('creates an entry with an IMAGE value', async () => {
    const entry = await $fetch<{ id: string; data: Record<string, unknown> }>(
      '/api/content-entries',
      {
        method: 'POST',
        headers: { Cookie: await getSessionCookie() },
        body: {
          contentTypeId: imageTypeId,
          data: {
            title: 'IMAGE field test entry',
            hero: sampleImage,
          },
          status: 'DRAFT',
        },
      }
    );
    expect(entry.data.hero).toEqual(sampleImage);
    entryId = entry.id;
  });

  it('reads the entry back with the IMAGE value intact', async () => {
    const entry = await $fetch<{ data: Record<string, unknown> }>(
      `/api/content-entries/${entryId}`,
      { headers: { Cookie: await getSessionCookie() } }
    );
    expect(entry.data.hero).toEqual(sampleImage);
  });

  it('updates the IMAGE value to a new object', async () => {
    const nextImage = { ...sampleImage, storageKey: 'next.webp' };
    const updated = await $fetch<{ data: Record<string, unknown> }>(
      `/api/content-entries/${entryId}`,
      {
        method: 'PUT',
        headers: { Cookie: await getSessionCookie() },
        body: {
          data: { title: 'IMAGE field test entry', hero: nextImage },
        },
      }
    );
    expect(updated.data.hero).toEqual(nextImage);
  });

  it('clears the IMAGE value with null', async () => {
    const updated = await $fetch<{ data: Record<string, unknown> }>(
      `/api/content-entries/${entryId}`,
      {
        method: 'PUT',
        headers: { Cookie: await getSessionCookie() },
        body: {
          data: { title: 'IMAGE field test entry', hero: null },
        },
      }
    );
    expect(updated.data.hero).toBeNull();
  });
});
```

**Note:** if the existing file's session helper is named differently (e.g. `authHeaders`), or uses a different content-type creation pattern, adapt — do NOT rename the existing helper. The intent of the snippet should be preserved: create a type with IMAGE field, CRUD an entry with an IMAGE value.

- [ ] **Step 3: Run the test file**

Run: `pnpm test server/api/content-entries/content-entries.test.ts`

Expected: Existing tests + 5 new IMAGE tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/api/content-entries/content-entries.test.ts
git commit -m "test(content-entries): IMAGE field end-to-end"
```

---

## Task 11: Final verification + docs

**Files:**

- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`

Expected: No errors.

- [ ] **Step 2: Lint**

Run: `pnpm lint`

Expected: No errors.

- [ ] **Step 3: Format check**

Run: `pnpm format`

Expected: No files need formatting.

- [ ] **Step 4: Full test suite**

Run: `pnpm test`

Expected: All tests pass (previous 369 + new IMAGE unit, integration, and end-to-end tests).

- [ ] **Step 5: Update CLAUDE.md**

Open `CLAUDE.md`. Add entries in the appropriate sections:

**Under "Dynamic Content Types" → "FieldType enum":**
Append `, IMAGE (file reference + dimensions + focal point, validated as shape-only)` to the list of enum values.

**Under "ContentEntry" (or wherever content-entry field validation is documented):**
Add a bullet documenting the IMAGE field value shape:

```
- **IMAGE field value** — `{ storageKey, mimeType, width, height, fileSize, originalName, focalPointX, focalPointY }` in JSONB. `storageKey` identifies the file in `images:originals` unstorage. Focal point defaults to 0.5/0.5 if omitted.
```

**Under "Image upload & transform":**
Add a paragraph describing the parallel file pipeline:

```
- **Primitive file pipeline** — `POST /api/files/upload` (session auth required) returns `{ storageKey, mimeType, width, height, fileSize, originalName }` without creating a DB row. `GET /api/files/:storageKey/transform` (public, rate limited 100/60s per IP) serves transformed variants keyed by storage key. Both endpoints share the `images:originals` / `images:transforms` unstorage buckets with the legacy `/api/images/*` routes — storage keys are UUID-prefixed so collisions cannot occur.
```

**Under "Key Files":**
Add:

```
- `server/api/files/upload.post.ts` — primitive file upload (no DB row)
- `server/api/files/[storageKey]/transform.get.ts` — public transform by storage key
- `server/api/files/files.test.ts` — file upload + transform integration tests
- `components/ImageField.vue` — IMAGE field editor component
```

- [ ] **Step 6: Update README.md**

Open `README.md`. In the "Architecture" or "Image upload & transform" section, add one sentence after the existing image-upload paragraph:

```
- **Primitive file pipeline** — `POST /api/files/upload` + `GET /api/files/:storageKey/transform` provide a decoupled upload → storage-key → transform flow used by the `IMAGE` field type on dynamic content types. Shares the `images:*` unstorage buckets with the legacy `/api/images/*` pipeline.
```

In the "Field types" or equivalent section (wherever the existing FieldType list is), append `IMAGE` to the list.

Exact wording is the implementer's call — match the existing file's style.

- [ ] **Step 7: Commit docs**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document IMAGE field and /api/files/* pipeline"
```

---

## Plan Complete

All tasks:

1. Add IMAGE to `FieldType` enum + migration
2. `validateEntryData` IMAGE case + unit tests
3. `POST /api/files/upload` primitive endpoint
4. `GET /api/files/:storageKey/transform` + auth allow-list
5. Integration tests for `/api/files/*`
6. `ImageFieldConfig` in types union
7. `ImageField.vue` component
8. Wire IMAGE into `ContentEditor.vue`
9. Map `IMAGE` FieldType → `image` FieldConfig in entry editor pages
10. End-to-end IMAGE field test on a content entry
11. Final verification + docs
