# IMAGE Field Type

## Overview

Add a new `IMAGE` field type to the dynamic content type system, plus decoupled file-upload and transform endpoints that operate on storage keys. This unblocks image handling on dynamic content types (e.g. an `Image` content type with an IMAGE field + TEXT fields for alt/caption) and is a prerequisite for the base starter bundle work.

**Scope:**

- New `IMAGE` value in the `FieldType` enum
- `POST /api/files/upload` — primitive file-write endpoint returning `{ storageKey, mimeType, width, height, fileSize, originalName }`
- `GET /api/files/:storageKey/transform` — public, cached, rate-limited image transform
- Entry validation updated to handle the IMAGE field shape
- Minimal editor UI (`ImageField.vue`) for upload + preview + remove

**Coexistence, not replacement.** The existing `/api/images/upload` and `/api/images/:id/transform` endpoints, and the `Image` Prisma model, remain intact. They're wired into legacy CMS flows (rugby crest, player headshots, Article featured image). The rugby-deletion project will remove them later. This spec adds a parallel file-field pipeline rather than refactoring the existing one.

**Out of scope (logged for later):**

- FILE type for non-image uploads
- Orphan file cleanup when an IMAGE field is replaced
- Field options (`maxSize`, `allowedMimeTypes`, `minWidth`, etc.)
- Refactoring or removing legacy `/api/images/*` routes
- UI polish beyond basic upload + preview (focal-point picker, media library, drag-and-drop, progress indicator)
- Including file bytes inside content bundles

## IMAGE Field Type

### Enum change

Add `IMAGE` to the `FieldType` enum in `prisma/schema/base.prisma`:

```
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

Requires a Prisma migration (new enum value).

### Field value shape

When the field has a value, the JSONB entry is an object:

```ts
{
  storageKey: string,       // e.g. "abc123.webp"
  mimeType: string,         // e.g. "image/webp"
  width: number,            // pixels, post-processing
  height: number,           // pixels, post-processing
  fileSize: number,         // bytes
  originalName: string | null,  // user's filename at upload time
  focalPointX: number,      // 0.0–1.0, default 0.5
  focalPointY: number       // 0.0–1.0, default 0.5
}
```

Or `null` when unset.

### Field options

None in v1. Future additive options (`maxSize`, `allowedMimeTypes`, `minWidth`, `minHeight`, `requiredAspectRatio`) can live in the existing `ContentTypeField.options` JSONB without further schema changes.

### Content-bundle portability

The portable export/import walkers in `scripts/content-bundle/portable.ts` skip IMAGE fields — `storageKey` is opaque and not a cross-instance reference. Portable bundles containing entries with IMAGE fields will have dangling storage keys on a target instance until files are copied by some other means. This is a known limitation, solved later by either bundling bytes or surfacing a "files missing" warning at import.

## Upload Endpoint

### Route & auth

- `POST /api/files/upload`
- Session cookie required (CMS users). The global auth middleware already covers `/api/*`; no allow-list change needed for this route.
- Rejects API-key auth — file uploads are editor territory, not external-consumer territory.

### Request

`multipart/form-data` with a single required part named `file`. No other form fields (alt, caption, focal point) are accepted here — those live on the containing content entry.

### Validation

Reuses the existing pipeline from `/api/images/upload`:

1. `filePart` must exist with `data` and `type` → 400 if missing.
2. `filePart.type` must be in `ALLOWED_MIME_TYPES` (jpeg / png / webp / gif / avif) → 415.
3. Magic-bytes header check against `MAGIC_BYTES` map → 415 on mismatch. Catches spoofed `Content-Type`.
4. `filePart.data.length <= IMAGE_UPLOAD_MAX_SIZE` (5 MB) → 413.

### Processing

- `processOriginal(Buffer.from(filePart.data))` — auto-orient, strip EXIF, clamp max dimension to 4000 px. Returns `{ data, format, width, height }`.
- Generate storage key: `${crypto.randomUUID()}.${processed.format}`.
- Store via `useStorage('images:originals').setItemRaw(storageKey, processed.data)`.

### Rate limiting

`enforceMutationRateLimit(event, 'files.upload')` — per-IP sliding window (30 req / 60 s).

### Response

`201 Created`:

```json
{
  "storageKey": "abc123.webp",
  "mimeType": "image/webp",
  "width": 1600,
  "height": 900,
  "fileSize": 123456,
  "originalName": "sunset.jpg"
}
```

No `focalPointX` / `focalPointY` — the upload primitive is focal-point-agnostic. The editor UI sets focal point when it composes the IMAGE field value on the content entry.

## Transform Endpoint

### Route & auth

- `GET /api/files/:storageKey/transform`
- Public — no session, no API key.
- Must be added to the global auth middleware's public-route allow-list (same pattern as `/api/images/:id/transform`).

### Query params

All optional, pass through to `transformImage`:

- `w` — target width (int)
- `h` — target height (int)
- `f` — output format: `jpeg | png | webp | avif`
- `q` — quality 1–100
- `fit` — `cover | contain | fill | inside | outside`

### Flow

1. Validate `storageKey` against a strict regex (e.g. `^[a-zA-Z0-9-]+\.(jpeg|jpg|png|webp|gif|avif)$`) to prevent path traversal or arbitrary-key reads. Reject with 400 on mismatch.
2. Apply a per-IP transform rate limit using `rateLimit('transform:${ip}')` — 100 req / 60 s, matching the current `/api/images/:id/transform` implementation. 429 on reject.
3. Fetch original from `useStorage('images:originals').getItemRaw(storageKey)`. If `null` → 404.
4. Build a cache key from the storage key + query-param signature. Check `useStorage('images:transforms')`. If hit, serve the cached variant directly.
5. On cache miss, run `transformImage(originalBuffer, { w, h, f, q, fit })`. Write the result to the transforms bucket. Serve.

### Response headers

- `Content-Type: image/{format}`
- `Cache-Control: public, max-age=31536000, immutable`
- `Content-Length: {size}`

Most of the logic in `server/api/images/[id]/transform.get.ts` is reusable — the only substantive change is the lookup source (storage key directly from path param vs. Image row ID → `storagePath`).

## Entry Validation

Edit `server/utils/validateEntryData.ts` to add an `IMAGE` case to the switch:

```ts
case 'IMAGE': {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field.name} must be an object`,
    });
  }
  const img = value as Record<string, unknown>;

  // Required primitives
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

  // Optional / defaulted
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

**Behavioural notes:**

- No DB side-effect. Unlike RELATION / MULTIRELATION, IMAGE doesn't cross-reference other rows — no `prisma.contentEntry.findFirst` call. Pure shape validation.
- Focal-point values outside `[0, 1]` silently clamp to `0.5`. Friendlier default for editor UI than a rejection.
- Unknown keys on the input object are dropped, consistent with other field types.
- `extractSlug` and `extractEntryTitle` are unchanged — IMAGE fields don't produce a title or slug.

## Editor UI

### New component: `components/ImageField.vue`

Renders a single IMAGE field. Minimal v1 — goal is "can save and clear end-to-end".

**Props:**

- `modelValue: ImageFieldValue | null`
- `field: ImageFieldConfig`

**Emits:**

- `update:modelValue` with the new value (or `null` on clear)

**States:**

- **Empty** — labelled file input button ("Upload image"), disabled during upload
- **Filled** — preview `<img>` via `/api/files/:storageKey/transform?w=400`, file metadata line ("1600 × 900, 123 KB, sunset.jpg"), "Remove" button (emits `null`)

**Upload flow on file select:**

1. `POST` the file to `/api/files/upload` via `$fetch`.
2. On 201, compose the IMAGE field value: spread the response + `focalPointX: 0.5, focalPointY: 0.5`.
3. Emit `update:modelValue` with the composed value.
4. On error, show the server's error message inline.

### ContentEditor integration

Add the IMAGE case to the field-type switch in `components/ContentEditor.vue`, matching the existing RICHTEXT / RELATION pattern:

```vue
<template v-else-if="field.type === 'IMAGE'">
  <ImageField :field="field" v-model="state[field.identifier]" />
</template>
```

Add `ImageFieldConfig` to the `FieldConfig` discriminated union in `types/contentEditor.ts`:

```ts
export interface ImageFieldConfig extends BaseFieldConfig {
  type: 'IMAGE';
}
```

### Explicitly deferred

- Focal-point picker (drag overlay on preview)
- Replace-without-clearing UX
- Media library / pick-existing-file
- Progress indicator during upload
- Drag-and-drop upload target

## Coexistence With Legacy Image Pipeline

**Untouched in this spec:**

- `prisma/schema/image.prisma` — `Image` Prisma model unchanged
- `server/api/images/upload.post.ts` — legacy upload
- `server/api/images/[id]/transform.get.ts` — legacy transform
- `server/api/images/[id].get.ts`, `[id].put.ts`, `images.get.ts`, `options.get.ts`, `[id]/placeholder.get.ts`
- All Player / Author / Article / Club pages and composables that reference the legacy model

**Shared infrastructure** (deliberately reused):

- `server/utils/imageProcessing.ts` — `processOriginal`, `transformImage`, `ALLOWED_MIME_TYPES`, `IMAGE_UPLOAD_MAX_SIZE`, `IMAGE_MAX_DIMENSION`
- `useStorage('images:originals')` — shared bucket; storage keys are UUID-prefixed so collisions can't occur
- `useStorage('images:transforms')` — shared cache bucket; cache keys include the storage key
- Rate limiter utilities
- `server/middleware/csrf.ts` — protects `POST /api/files/upload` automatically
- `server/middleware/auth.ts` — needs `/api/files/:storageKey/transform` added to the public-route allow-list (mirrors the existing entry for `/api/images/:id/transform`)

**Bucket-shared, semantically split:**

- Legacy flow: upload → `Image` row → storage key in `storagePath` column; transform looks up by row ID.
- New flow: upload → returns storage key directly, no DB row; transform reads storage key straight from URL.

**Forward note for rugby-deletion:** legacy storage keys will live alongside new ones in the same bucket. Deletion must be per-row-metadata (remove only storage keys referenced by deleted `Image` rows), not a bucket nuke — otherwise it would orphan IMAGE fields on dynamic content entries.

## Testing

### Required

- **Unit tests** — `server/utils/validateEntryData.test.ts` adds IMAGE cases: valid full shape, focal point defaults to 0.5/0.5 when omitted, missing `storageKey` → 400, non-numeric `width` → 400, `null` value when required → 400, `null` value when optional → stored as null, out-of-range focal points clamp to 0.5.
- **Integration tests** — new file `server/api/files/files.test.ts`:
  - Upload: missing file (400), wrong mime (415), spoofed magic bytes (415), oversized (413), missing auth (401), rate-limited (429), success (201 with correct shape + file persisted to storage).
  - Transform: unknown storage key (404), resize with `w=` (200), format conversion with `f=webp` (200), path traversal on param (400), rate limit (429).
  - Shared-bucket sanity: uploading via new endpoint, confirming the legacy `/api/images/:id/transform` does NOT find it (queried by Image row ID, not storage key).
- **End-to-end field test** — `server/api/content-entries/content-entries.test.ts` adds cases for an IMAGE field on a dynamic content type: create with IMAGE populated, read back, update with new value, clear with `null`. Mirrors the pattern for RICHTEXT and RELATION.

### Not required

- Vue component tests for `ImageField.vue` (matches existing repo pattern — field components don't have unit tests).
- Visual regression or browser end-to-end (no Playwright/Cypress in the repo).

### Pre-merge checks

`pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test` — all clean.

## Known Limitations

These are deliberate deferrals, not bugs:

1. **Portable bundle + IMAGE** — files aren't copied by the bundle CLI. Target instance will 404 on transforms until files are transferred out-of-band.
2. **Orphaned files on replace** — replacing an IMAGE field leaves the prior file in storage. Storage is cheap; revisit when orphan volume becomes a problem.
3. **No media library** — every upload is one-shot per field. No global picker for existing files.
4. **No focal-point picker UI** — defaults to center (0.5 / 0.5); custom values can be set via API but not in the editor.
5. **Image-only** — no FILE type for documents or non-image uploads.

## Future Work (Out of Scope)

- FILE field type for generic (non-image) uploads
- Orphan cleanup (reference counting or admin task)
- Field options (`maxSize`, `allowedMimeTypes`, `minWidth`, `minHeight`, `requiredAspectRatio`)
- Media library / global file picker
- Focal-point picker UI
- Drag-and-drop upload target, upload progress indicator
- Content bundles that include file bytes (or surface a "files missing" warning at import)
- Refactoring or removing `/api/images/*` and the `Image` Prisma model (rugby-deletion project)
