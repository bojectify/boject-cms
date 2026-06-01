import type {
  ApiKeyCreateResponse,
  ApiKeyListItem,
  ApplySchemaResultLike,
  BlockerLike,
  Bundle,
  EntriesImportResultLike,
} from './types.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly data?: unknown
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface ApiContext {
  baseUrl: string;
  apiKey: string;
}

/**
 * Wraps `fetch` for the CMS REST surface.
 *
 * - Adds `Authorization: Bearer <apiKey>` to every request.
 * - Sets `Content-Type: application/json` only when a body is supplied.
 * - Parses the response body as JSON when possible, falling back to the
 *   raw text on parse failure (and to `null` on empty bodies).
 * - On non-2xx responses, throws a structured {@link HttpError} so each
 *   command can switch on `.code` (e.g. `BUNDLE_INVALID`,
 *   `SCHEMA_APPLY_BLOCKED`) without re-implementing parsing. Nuxt's
 *   `createError({ data })` shape is unwrapped: the inner `data.error`
 *   becomes `code`, and the outer `message` is preserved.
 */
async function callJson<T>(
  ctx: ApiContext,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${ctx.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ctx.apiKey}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) {
    const data =
      (parsed && typeof parsed === 'object' && 'data' in parsed
        ? (parsed as { data: unknown }).data
        : parsed) ?? null;
    const code =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: string }).error)
        : `HTTP_${res.status}`;
    const message =
      (parsed && typeof parsed === 'object' && 'message' in parsed
        ? String((parsed as { message: string }).message)
        : null) ?? `${method} ${path} returned ${res.status}`;
    throw new HttpError(res.status, code, message, data);
  }
  return parsed as T;
}

export function getSchemaBundle(ctx: ApiContext): Promise<Bundle> {
  return callJson<Bundle>(ctx, 'GET', '/api/schema/export');
}

export interface ApplyArgs {
  bundle: Bundle;
  allowDestructive?: boolean;
  dryRun?: boolean;
}

export function applySchemaRemote(
  ctx: ApiContext,
  args: ApplyArgs
): Promise<ApplySchemaResultLike> {
  return callJson<ApplySchemaResultLike>(
    ctx,
    'POST',
    '/api/schema/apply',
    args
  );
}

export interface EntriesExportQuery {
  portable?: boolean;
  includeDrafts?: boolean;
  contentType?: string;
}

export function getEntriesBundle(
  ctx: ApiContext,
  query: EntriesExportQuery = {}
): Promise<Bundle> {
  const params = new URLSearchParams();
  if (query.portable === false) params.set('portable', 'false');
  if (query.includeDrafts) params.set('includeDrafts', 'true');
  if (query.contentType) params.set('contentType', query.contentType);
  const qs = params.toString();
  return callJson<Bundle>(
    ctx,
    'GET',
    `/api/content-bundle/export${qs ? `?${qs}` : ''}`
  );
}

export interface EntriesImportArgs {
  bundle: Bundle;
  author?: string;
  onConflict?: 'fail' | 'skip' | 'replace';
  dryRun?: boolean;
}

export function importEntriesRemote(
  ctx: ApiContext,
  args: EntriesImportArgs
): Promise<EntriesImportResultLike> {
  return callJson<EntriesImportResultLike>(
    ctx,
    'POST',
    '/api/content-bundle/import',
    args
  );
}

export type {
  Bundle,
  ApplySchemaResultLike,
  BlockerLike,
  EntriesImportResultLike,
};

export function createApiKey(
  ctx: ApiContext,
  args: { name: string; scopes: string[] }
): Promise<ApiKeyCreateResponse> {
  return callJson<ApiKeyCreateResponse>(ctx, 'POST', '/api/apikeys', args);
}

export function listApiKeys(
  ctx: ApiContext
): Promise<{ items: ApiKeyListItem[] }> {
  return callJson<{ items: ApiKeyListItem[] }>(ctx, 'GET', '/api/apikeys');
}

export async function revokeApiKey(
  ctx: ApiContext,
  prefix: string
): Promise<void> {
  await callJson<null>(ctx, 'DELETE', `/api/apikeys/${prefix}`);
}
