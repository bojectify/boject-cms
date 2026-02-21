import { createYoga } from 'graphql-yoga';
import { getSchema } from '../graphql/schema';

const yoga = createYoga({
  schema: getSchema(),
  graphqlEndpoint: '/api/graphql',
  graphiql: process.env.NODE_ENV !== 'production',
});

export default defineEventHandler((event) => {
  const { req, res } = event.node;
  return yoga(req, res);
});
