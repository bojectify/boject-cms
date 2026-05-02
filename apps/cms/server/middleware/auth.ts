export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname;

  // Only protect /api/* routes
  if (!path.startsWith('/api/')) return;

  // Skip auth-related routes, GraphQL (has its own API key gate), public image endpoints, and the health probe
  if (
    path === '/api/health' ||
    path.startsWith('/api/auth/') ||
    path.startsWith('/api/_auth/') ||
    path.startsWith('/api/graphql') ||
    /^\/api\/files\/[^/]+\/transform$/.test(path)
  ) {
    return;
  }

  // Try session auth first
  const session = await getUserSession(event);
  if (session.user) {
    // Verify the session's passwordVersion still matches the DB.
    // Cross-device session invalidation: when a user changes their password,
    // we bump User.passwordVersion. Old cookies still claim the previous
    // version and get 401'd here on their next request.
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

  // Fall back to API key auth (read-only access by default)
  const result = await validateApiKey(event);
  if (result.valid) {
    event.context.authMethod = 'apikey';
    event.context.apiKeyScopes = result.scopes;
    const method = getMethod(event);
    if (method !== 'GET' && method !== 'HEAD') {
      // Allow non-GET on the schema apply endpoint specifically; the
      // endpoint asserts `schema:write` itself. Other endpoints stay
      // read-only for API keys.
      if (path !== '/api/schema/apply') {
        throw createError({
          statusCode: 403,
          message: 'API keys have read-only access',
        });
      }
    }
    return;
  }

  throw createError({ statusCode: 401, message: 'Unauthorized' });
});
