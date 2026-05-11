export interface ProbeOk {
  ok: true;
}

export interface ProbeMissing {
  ok: false;
  missingScope: 'content:write';
}

export interface ProbeIndeterminate {
  ok: false;
  error: string;
}

export type ProbeResult = ProbeOk | ProbeMissing | ProbeIndeterminate;

export interface ProbeContentWriteScopeOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

// Deliberately bad: valid-format UUID (passes the contentTypeId UUID
// shape check) but no real ContentType row has the all-zero UUID. The
// CMS handler order is: rate-limit → assertApiKeyScope → readBody →
// assertUuid → contentType lookup. So a content:read-only key hits the
// 403 before any of the body shape is examined, which is the property
// we depend on to distinguish "missing scope" from "scope OK but body
// invalid". See apps/cms/server/api/content-entries/content-entries.test.ts
// for the contract pin.
const SENTINEL_BODY = {
  contentTypeId: '00000000-0000-0000-0000-000000000000',
  data: {},
};

const PROBE_PATH = '/api/content-entries';

export async function probeContentWriteScope(
  opts: ProbeContentWriteScopeOptions
): Promise<ProbeResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const url = `${baseUrl}${PROBE_PATH}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(SENTINEL_BODY),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }

  if (response.status === 401) {
    return { ok: false, error: 'API key invalid or revoked' };
  }

  if (response.status === 429) {
    return {
      ok: false,
      error: 'rate limited by CMS — wait 60s and retry',
    };
  }

  if (response.status === 403) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // Defensive: a 403 from this endpoint means auth said no. If the
      // body can't be parsed we still treat it as a missing-scope
      // signal rather than indeterminate.
      return { ok: false, missingScope: 'content:write' };
    }

    const errorCode = extractErrorCode(body);
    if (errorCode === 'INSUFFICIENT_SCOPE') {
      return { ok: false, missingScope: 'content:write' };
    }

    if (errorCode === undefined) {
      // Parseable JSON but no `data.error` field — there's no way to
      // distinguish this from a malformed 403, so stay defensive and
      // treat it as missing scope.
      return { ok: false, missingScope: 'content:write' };
    }

    return { ok: false, error: 'unexpected 403 from probe endpoint' };
  }

  return { ok: true };
}

function extractErrorCode(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object') return undefined;
  const data = (body as { data?: unknown }).data;
  if (data === null || typeof data !== 'object') return undefined;
  const error = (data as { error?: unknown }).error;
  return typeof error === 'string' ? error : undefined;
}
