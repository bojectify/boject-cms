import type { BundleEntry } from '../vendor/contentBundleTypes.js';
import type { GeneratedSeed } from './generate.js';
import { rewriteSyntheticIds } from './rewriteSyntheticIds.js';
import {
  SeedMostlyDuplicateError,
  SEED_DUPLICATE_THRESHOLD,
} from './seedErrors.js';

const SKIPPED = Symbol('skipped-duplicate');
type SkippedSentinel = typeof SKIPPED;

export interface WriteViaHttpOptions {
  baseUrl: string;
  apiKey: string;
  generated: GeneratedSeed;
  concurrency?: number;
  onProgress?: (n: number, total: number) => void;
}

export class AuthError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'API key rejected — check key validity and CSRF / Origin headers'
    );
    this.name = 'AuthError';
  }
}

export class ApiKeyReadOnlyError extends Error {
  constructor() {
    super(
      'API keys are currently read-only on /api/content-entries (auth ' +
        'middleware blocks non-GET methods). HTTP-mode seeding requires the ' +
        '`content:write` scope, tracked in ' +
        'https://github.com/bojectify/boject-cms/issues/172. Until that ' +
        'lands, use --database-url for SQL-mode seeding instead.'
    );
    this.name = 'ApiKeyReadOnlyError';
  }
}

export class RateLimitedError extends Error {
  constructor(
    public attempts: number,
    public partialProgress: number
  ) {
    super(
      `Rate-limited after ${attempts} retries (inserted ${partialProgress} entries before bailing)`
    );
    this.name = 'RateLimitedError';
  }
}

export class EntryValidationError extends Error {
  constructor(
    public entryIndex: number,
    public contentTypeIdentifier: string,
    public body: unknown
  ) {
    super(
      `Entry validation failed (${contentTypeIdentifier}, index ${entryIndex}): ${JSON.stringify(body)}`
    );
    this.name = 'EntryValidationError';
  }
}

const MAX_RETRIES = 5;
const RETRY_AFTER_DEFAULT_SECONDS = 1;
const FIVE_HUNDRED_RETRY_DELAY_MS = 1000;

/**
 * POSTs each entry to create a DRAFT, then PUTs with status=PUBLISHED to
 * publish. Two requests per entry. Concurrency capped via a simple
 * semaphore (default 8). 429 responses honour Retry-After (seconds).
 *
 * Cross-group synthetic-id rewriting threads through the run via `idMap`.
 * Groups are processed in order; each group fully completes before the
 * next starts so all dependencies are present in `idMap` when their
 * dependents post.
 */
export async function writeViaHttp(
  opts: WriteViaHttpOptions
): Promise<{ inserted: number; skipped: number }> {
  const { baseUrl, apiKey, generated, onProgress } = opts;
  const concurrency = opts.concurrency ?? 8;
  const total = generated.groups.reduce((s, g) => s + g.entries.length, 0);
  const idMap = new Map<string, string>(); // synthetic → real
  let inserted = 0;
  let skipped = 0;

  for (const group of generated.groups) {
    // Fully drain this group before moving on so its IDs are in idMap
    // for any later group that references them.
    const queue: Array<[number, BundleEntry]> = [...group.entries.entries()];

    async function worker(): Promise<void> {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) return;
        const [, entry] = next;
        const result = await postAndPublish(baseUrl, apiKey, entry, idMap);
        if (result === SKIPPED) {
          skipped++;
        } else {
          if (entry.id) idMap.set(entry.id, result);
          inserted++;
          onProgress?.(inserted, total);
        }
      }
    }

    const workerCount = Math.min(concurrency, group.entries.length);
    if (workerCount === 0) continue;
    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workers);
  }

  // Apply patches (deferred fields)
  for (const group of generated.groups) {
    if (!group.patches) continue;
    for (const patch of group.patches) {
      const realEntryId = idMap.get(patch.entryId) ?? patch.entryId;
      const updates = rewriteSyntheticIds(patch.fieldUpdates, idMap);
      await applyHttpPatch(baseUrl, apiKey, realEntryId, updates);
    }
  }

  const totalProcessed = inserted + skipped;
  if (
    totalProcessed > 0 &&
    skipped / totalProcessed > SEED_DUPLICATE_THRESHOLD
  ) {
    throw new SeedMostlyDuplicateError(inserted, skipped, totalProcessed);
  }
  return { inserted, skipped };
}

async function postAndPublish(
  baseUrl: string,
  apiKey: string,
  entry: BundleEntry,
  idMap: Map<string, string>
): Promise<string | SkippedSentinel> {
  if (!entry.versions?.[0]) {
    throw new Error(
      `Bundle entry ${entry.id ?? '<unknown>'} has no versions; cannot post`
    );
  }
  const v = entry.versions[0];
  const rewrittenData = rewriteSyntheticIds(v.data, idMap);

  // POST to create DRAFT
  const created = await retryingFetch(`${baseUrl}/api/content-entries`, {
    method: 'POST',
    headers: jsonHeaders(apiKey),
    body: JSON.stringify({
      contentTypeId: entry.contentTypeId,
      data: rewrittenData,
      slug: entry.slug,
    }),
  });
  if (created === SKIPPED) return SKIPPED;
  const realId = (created as { id: string }).id;

  // PUT to publish
  const published = await retryingFetch(
    `${baseUrl}/api/content-entries/${realId}`,
    {
      method: 'PUT',
      headers: jsonHeaders(apiKey),
      body: JSON.stringify({
        data: rewrittenData,
        status: 'PUBLISHED',
      }),
    }
  );
  if (published === SKIPPED) return SKIPPED;

  return realId;
}

async function applyHttpPatch(
  baseUrl: string,
  apiKey: string,
  entryId: string,
  fieldUpdates: unknown
): Promise<void> {
  await retryingFetch(`${baseUrl}/api/content-entries/${entryId}`, {
    method: 'PUT',
    headers: jsonHeaders(apiKey),
    body: JSON.stringify({ data: fieldUpdates, status: 'PUBLISHED' }),
  });
}

function jsonHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

async function retryingFetch(
  url: string,
  init: RequestInit
): Promise<unknown | SkippedSentinel> {
  let attempt = 0;
  let last5xx = false;
  while (attempt < MAX_RETRIES) {
    const res = await fetch(url, init);
    if (res.status === 403) {
      // Distinguish "key has no write scope" (read-only middleware gate) from
      // generic 403s. The middleware sends a JSON body with `message` =
      // 'API keys have read-only access'; sniff for it.
      const body = await res.text().catch(() => '');
      if (/read-only/i.test(body)) throw new ApiKeyReadOnlyError();
      throw new AuthError(`Access denied (403): ${body}`);
    }
    if (res.status === 401) throw new AuthError();
    if (res.status === 429) {
      const retryAfter = parseInt(
        res.headers.get('Retry-After') ?? String(RETRY_AFTER_DEFAULT_SECONDS),
        10
      );
      await sleep(Math.max(retryAfter, 0) * 1000);
      attempt++;
      continue;
    }
    if (res.status === 422) {
      const body = await res.json().catch(() => ({}));
      throw new EntryValidationError(0, 'unknown', body);
    }
    if (res.status === 409) {
      return SKIPPED;
    }
    if (res.status >= 500 && res.status < 600) {
      if (last5xx) {
        throw new Error(`Upstream 5xx after retry: ${res.status}`);
      }
      last5xx = true;
      await sleep(FIVE_HUNDRED_RETRY_DELAY_MS);
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Unexpected ${res.status}: ${body}`);
    }
    return res.json();
  }
  throw new RateLimitedError(MAX_RETRIES, 0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
