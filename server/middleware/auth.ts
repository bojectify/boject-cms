export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname;

  // Only protect /api/* routes
  if (!path.startsWith('/api/')) return;

  // Skip auth-related routes and GraphQL (has its own API key gate)
  if (
    path.startsWith('/api/auth/') ||
    path.startsWith('/api/_auth/') ||
    path.startsWith('/api/graphql')
  ) {
    return;
  }

  // Try session auth first
  const session = await getUserSession(event);
  if (session.user) return;

  // Fall back to API key auth (read-only access)
  const result = await validateApiKey(event);
  if (result.valid) {
    const method = getMethod(event);
    if (method !== 'GET' && method !== 'HEAD') {
      throw createError({
        statusCode: 403,
        message: 'API keys have read-only access',
      });
    }
    return;
  }

  throw createError({ statusCode: 401, message: 'Unauthorized' });
});
