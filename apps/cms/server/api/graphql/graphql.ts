import { createYoga } from 'graphql-yoga';
import {
  defineEventHandler,
  getRequestHeader,
  setResponseHeader,
  setResponseStatus,
} from 'h3';
import { maxDepthPlugin } from '@escape.tech/graphql-armor-max-depth';
import { getSchema } from '../../graphql/schema';
import { validateApiKey } from '../../utils/validateApiKey';
import {
  buildRateLimitedExtensions,
  checkGraphqlRateLimit,
} from '../../utils/rateLimitEndpoint';
import { complexityYogaPlugin } from '../../utils/graphqlComplexity';

const yoga = createYoga({
  schema: () => getSchema(),
  graphqlEndpoint: '/api/graphql',
  graphiql: process.env.NODE_ENV !== 'production',
  plugins: [maxDepthPlugin({ n: 15 }), complexityYogaPlugin],
});

export default defineEventHandler(async (event) => {
  const { req, res } = event.node;
  const isProduction = process.env.NODE_ENV === 'production';
  const authHeader = getRequestHeader(event, 'authorization');

  // Dev mode without an Authorization header — let GraphiQL introspect freely.
  // Once a Bearer header is present (or in production) we always validate so
  // the scope gate below cannot be bypassed by sending a non-prod build.
  if (!isProduction && !authHeader) {
    return yoga(req, res);
  }

  const result = await validateApiKey(event);
  if (!result.valid) {
    setResponseStatus(event, 401);
    return { error: result.message };
  }

  // Defence in depth: GraphQL is the canonical "external app reads content"
  // surface. Even though the migration backfill grants every existing key
  // content:read, a key minted today with an empty (or schema-only) scope set
  // must not be able to exfiltrate content here.
  if (!result.scopes.includes('content:read')) {
    setResponseStatus(event, 403);
    return { error: 'INSUFFICIENT_SCOPE', required: 'content:read' };
  }

  if (isProduction) {
    const limit = checkGraphqlRateLimit(result.apiKeyId);
    if (!limit.allowed) {
      const extensions = buildRateLimitedExtensions(
        'graphql',
        limit.retryAfterMs
      );
      setResponseHeader(event, 'Retry-After', extensions.retryAfter);
      setResponseStatus(event, 429);
      return {
        errors: [{ message: 'Too many requests', extensions }],
      };
    }
  }

  return yoga(req, res);
});
