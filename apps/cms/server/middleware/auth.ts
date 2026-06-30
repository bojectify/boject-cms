const API_KEY_WRITABLE_PATHS = new Set([
  '/api/schema/apply',
  '/api/apikeys',
  '/api/content-bundle',
  '/api/public/entries',
]);

// Paths where an API key is a valid credential at all. Everything else under
// /api/* (after the skips below) is session-only for tokens — default-deny.
// A token on a non-permitted path falls through to the session branch and,
// with no session, gets 401. This makes cache integrity structural: admin
// content (/api/entries, /api/all-content, /api/content-types) has no token
// route, so a token can only read PUBLISHED content via the cached
// /api/public/* (or Meili /api/search). (#257)
const TOKEN_API_PREFIXES = [
  '/api/schema',
  '/api/content-bundle',
  '/api/apikeys',
  '/api/search',
];

function isApiKeyWritablePath(path: string): boolean {
  if (API_KEY_WRITABLE_PATHS.has(path)) return true;
  for (const p of API_KEY_WRITABLE_PATHS) {
    if (path.startsWith(`${p}/`)) return true;
  }
  return false;
}

function isTokenApiPath(path: string): boolean {
  for (const p of TOKEN_API_PREFIXES) {
    if (path === p || path.startsWith(`${p}/`)) return true;
  }
  return false;
}

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname;

  // Only protect /api/* routes
  if (!path.startsWith('/api/')) return;

  // Skip auth-related routes, GraphQL (own API key gate), public image
  // endpoints, and the health probe.
  if (
    path === '/api/health' ||
    path.startsWith('/api/auth/') ||
    path.startsWith('/api/_auth/') ||
    path.startsWith('/api/graphql') ||
    /^\/api\/files\/[^/]+\/transform$/.test(path)
  ) {
    return;
  }

  const isPublicNamespace = path.startsWith('/api/public/');
  const tokenAllowed = isPublicNamespace || isTokenApiPath(path);

  // Session auth — skipped for the public namespace (token-only). A CMS session
  // authenticates on ANY non-public path (admin content + management alike).
  if (!isPublicNamespace) {
    const session = await getUserSession(event);
    if (session.user) {
      // Cross-device session invalidation: passwordVersion bump on password
      // change 401s old cookies on their next request.
      const dbUser = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { passwordVersion: true },
      });
      if (!dbUser || dbUser.passwordVersion !== session.user.passwordVersion) {
        await clearUserSession(event);
        throw createError({ statusCode: 401, message: 'Session invalidated' });
      }
      event.context.authMethod = 'session';
      return;
    }
  }

  // API-key auth — ONLY on token-permitted paths (default-deny). On a
  // session-only path the token is never consulted, so the request falls
  // through to the 401 below.
  if (tokenAllowed) {
    const result = await validateApiKey(event);
    if (result.valid) {
      event.context.authMethod = 'apikey';
      event.context.apiKeyScopes = result.scopes;
      event.context.apiKeyId = result.apiKeyId;
      const method = getMethod(event);
      if (
        method !== 'GET' &&
        method !== 'HEAD' &&
        !isApiKeyWritablePath(path)
      ) {
        throw createError({
          statusCode: 403,
          message: 'API keys have read-only access',
        });
      }
      return;
    }
  }

  throw createError({ statusCode: 401, message: 'Unauthorized' });
});
