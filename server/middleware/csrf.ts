const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const SKIP_PREFIXES = ['/api/auth/', '/api/_auth/', '/api/graphql'];

function isSkipped(path: string): boolean {
  if (SKIP_PREFIXES.some((p) => path.startsWith(p))) return true;
  if (/^\/api\/images\/[^/]+\/transform$/.test(path)) return true;
  if (/^\/api\/images\/[^/]+\/placeholder$/.test(path)) return true;
  return false;
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname;

  // Only gate /api/*
  if (!path.startsWith('/api/')) return;
  if (isSkipped(path)) return;

  const method = getMethod(event).toUpperCase();
  if (SAFE_METHODS.has(method)) return;

  // API-key requests are not ambient credentials — the browser does not
  // attach them automatically, so CSRF cannot forge them. Let them through;
  // the auth middleware still enforces read-only for API keys via method.
  const authHeader = getRequestHeader(event, 'authorization');
  if (authHeader?.startsWith('Bearer ')) return;

  const origin = getRequestHeader(event, 'origin');
  const referer = getRequestHeader(event, 'referer');
  const host = getRequestHeader(event, 'host');

  if (!host) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Missing Host header',
    });
  }

  const sourceHost = origin
    ? hostFromUrl(origin)
    : referer
      ? hostFromUrl(referer)
      : null;

  // Missing both Origin and Referer: likely server-to-server or test tooling.
  // Real browsers always send Origin on mutating cross-site requests, so the
  // CSRF threat is addressed by the explicit-host-mismatch check below. We
  // intentionally let missing-both through to avoid breaking legitimate
  // non-browser clients.
  if (!sourceHost) return;

  if (sourceHost !== host) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Cross-origin request rejected',
    });
  }
});
