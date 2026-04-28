import { createYoga } from 'graphql-yoga';
import { defineEventHandler } from 'h3';
import { maxDepthPlugin } from '@escape.tech/graphql-armor-max-depth';
import { getSchema } from '../../graphql/schema';
import { validateApiKey } from '../../utils/validateApiKey';
import { enforceGraphqlRateLimit } from '../../utils/rateLimitEndpoint';

const yoga = createYoga({
  schema: () => getSchema(),
  graphqlEndpoint: '/api/graphql',
  graphiql: process.env.NODE_ENV !== 'production',
  plugins: [maxDepthPlugin({ n: 15 })],
});

export default defineEventHandler(async (event) => {
  const { req, res } = event.node;

  // Allow all requests without auth in dev (GraphiQL playground needs POST for introspection)
  if (process.env.NODE_ENV !== 'production') {
    return yoga(req, res);
  }

  const result = await validateApiKey(event);
  if (!result.valid) {
    setResponseStatus(event, 401);
    return { error: result.message };
  }

  enforceGraphqlRateLimit(event, result.apiKeyId);

  return yoga(req, res);
});
