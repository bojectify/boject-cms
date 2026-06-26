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
  setRateLimitHeaders,
} from '../../utils/rateLimitEndpoint';
import { complexityYogaPlugin } from '../../utils/graphqlComplexity';
import { rateLimitExtensionPlugin } from '../../utils/graphqlRateLimitExtensions';
import { graphqlCachePlugin } from '../../utils/graphqlCachePlugin';
import type { YogaServerContext } from '../../utils/yogaContext';

const yoga = createYoga<YogaServerContext>({
  schema: () => getSchema(),
  graphqlEndpoint: '/api/graphql',
  graphiql: process.env.NODE_ENV !== 'production',
  plugins: [
    maxDepthPlugin({ n: 15 }),
    complexityYogaPlugin,
    rateLimitExtensionPlugin,
    graphqlCachePlugin,
  ],
});

export default defineEventHandler(async (event) => {
  const { req, res } = event.node;
  const isProduction = process.env.NODE_ENV === 'production';
  const authHeader = getRequestHeader(event, 'authorization');

  // Dev mode without an Authorization header — let GraphiQL introspect freely.
  // Once a Bearer header is present (or in production) we always validate so
  // the scope gate below cannot be bypassed by sending a non-prod build.
  if (!isProduction && !authHeader) {
    return yoga(req, res, { event });
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
    const snapshot = checkGraphqlRateLimit(result.apiKeyId);
    setRateLimitHeaders(event, snapshot);

    if (!snapshot.allowed) {
      const ext = buildRateLimitedExtensions('graphql', snapshot.retryAfterMs);
      setResponseHeader(event, 'Retry-After', ext.retryAfter);
      setResponseStatus(event, 429);
      return {
        errors: [
          {
            message: 'Too many requests',
            extensions: {
              ...ext,
              rateLimit: {
                limit: snapshot.limit,
                remaining: snapshot.remaining,
                reset: snapshot.resetSeconds,
              },
            },
          },
        ],
      };
    }

    event.context.rateLimitSnapshot = snapshot;
  }

  // #260: authenticated requests are cache-eligible (every prod request; dev
  // requests that carry a Bearer key). The dev-GraphiQL bypass above returns
  // before this line, so it's never cached.
  //
  // Under VITEST the webhook worker that drives cache invalidation is
  // test-guarded off, so caching by default would let a stale entry survive a
  // mutation. Tests therefore opt in per request via the `x-boject-test-cache`
  // header (value `1`), which is consulted ONLY under VITEST and is completely
  // inert in every other environment.
  if (process.env.VITEST === 'true') {
    if (getRequestHeader(event, 'x-boject-test-cache') === '1') {
      event.context.gqlCacheEligible = true;
    }
  } else {
    event.context.gqlCacheEligible = true;
  }

  return yoga(req, res, { event });
});
