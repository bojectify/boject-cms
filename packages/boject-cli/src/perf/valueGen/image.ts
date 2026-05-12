import { intInRange } from '../prng.js';

/**
 * Synthesised IMAGE field value — matches the shape of the `ImageFile` object
 * stored in the CMS's JSONB `data` column and exposed via GraphQL.
 *
 * **Important:** the `storageKey` does NOT correspond to a real file in
 * storage. Requests to `/api/files/<storageKey>/transform` will return 404.
 * No current k6 scenario touches that endpoint, so the synthesised JSON
 * exercises every relevant code path (GraphQL resolver, JSONB read/write,
 * REST envelope) without requiring an upload step.
 */
export interface GeneratedImage {
  storageKey: string;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
  fileSize: number;
  originalName: string;
  focalPointX: number;
  focalPointY: number;
}

/**
 * Generates a UUID-v4-shaped storage key from the PRNG stream.
 * Mirrors the `nextUuid` helper in `generate.ts` — inlined here to keep
 * `valueGen/` helpers self-contained with no dependency on `generate.ts`.
 *
 * Consumes 7 rand() calls per invocation.
 */
function nextUuid(rand: () => number): string {
  const hex = (n: number, width: number): string =>
    Math.floor(rand() * Math.pow(16, n))
      .toString(16)
      .padStart(width, '0');
  // 32 hex chars total in 8-4-4-4-12 layout.
  const segments = [
    hex(8, 8),
    hex(4, 4),
    // Force version-4 nibble in the third group.
    '4' + hex(3, 3),
    // Force variant nibble (8/9/a/b) in the fourth group.
    (Math.floor(rand() * 4) + 8).toString(16) + hex(3, 3),
    hex(8, 8) + hex(4, 4),
  ];
  return segments.join('-');
}

/**
 * Synthesises a plausible `ImageFile`-shaped JSON object for perf seed data.
 *
 * - `storageKey` — UUID-v4-shaped, deterministic per seed. Does NOT map to a
 *   real file; `/api/files/<key>/transform` will 404 if hit.
 * - `mimeType` — always `'image/jpeg'`
 * - `width` / `height` — random integers in [800, 3000]
 * - `fileSize` — `width * height * 3` (rough uncompressed-JPEG byte estimate)
 * - `originalName` — `image-${index}.jpg`
 * - `focalPointX` / `focalPointY` — both fixed at `0.5`
 */
export function generateImage(opts: {
  rand: () => number;
  index: number;
}): GeneratedImage {
  const { rand, index } = opts;
  const storageKey = nextUuid(rand);
  const width = intInRange(800, 3000, rand);
  const height = intInRange(800, 3000, rand);
  return {
    storageKey,
    mimeType: 'image/jpeg',
    width,
    height,
    fileSize: width * height * 3,
    originalName: `image-${index}.jpg`,
    focalPointX: 0.5,
    focalPointY: 0.5,
  };
}
