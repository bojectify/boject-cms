import { createYoga } from 'graphql-yoga';
import { defineEventHandler } from 'h3';
import { getSchema } from '../../graphql/schema';

const yoga = createYoga({
  schema: getSchema(),
  graphqlEndpoint: '/api/graphql',
  graphiql: process.env.NODE_ENV !== 'production',
});

export default defineEventHandler(async (event) => {
  const { req, res } = event.node;

  // Allow GET requests without auth in dev (GraphiQL playground)
  if (req.method === 'GET' && process.env.NODE_ENV !== 'production') {
    return yoga(req, res);
  }

  const result = await validateApiKey(event);
  if (!result.valid) {
    setResponseStatus(event, 401);
    return { error: result.message };
  }

  return yoga(req, res);
});
