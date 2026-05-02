import type { ApplySchemaResultLike, BlockerLike, Bundle } from './types.js';

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
  method: 'GET' | 'POST',
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

export type { Bundle, ApplySchemaResultLike, BlockerLike };
