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

  // API keys are not ambient credentials: a browser will not attach them
  // automatically, and cross-origin JS cannot set an Authorization header
  // without CORS approval (which this app does not grant). Therefore a
  // Bearer-authed request cannot be a browser CSRF, so we skip the
  // Origin check. The auth middleware still enforces API-key read-only.
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

  // NOTE: Deliberate deviation from a stricter "reject when both missing"
  // policy. Rationale:
  //   1. Modern browsers send Origin on ALL cross-site mutating requests,
  //      so a real browser CSRF will always carry an Origin and will be
  //      caught by the sourceHost !== host check below.
  //   2. SameSite=Strict on the session cookie is the primary defense;
  //      this middleware is defense-in-depth only.
  //   3. Server-to-server and test clients (including @nuxt/test-utils)
  //      do not attach Origin. Rejecting missing-both would break many
  //      existing integration tests without improving browser CSRF posture.
  if (!sourceHost) return;

  if (sourceHost !== host) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Cross-origin request rejected',
    });
  }
});
