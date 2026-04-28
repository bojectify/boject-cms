// Scenario 1B — GraphQL flat-RPS ramp.
// Drives the cms's GraphQL endpoint at increasing arrival rates to find
// the failure point. PERF_QUERY_SHAPE selects a query template:
//   - bare: small projection, no joins
//   - filtered: with a publishDate filter (exercises JSONB index path)
//   - relation: includes author RELATION (exercises sub-resolver)
// Requires the perf DB seeded and PERF_API_KEY exported.
import http from 'k6/http';
import { check } from 'k6';
import { loadK6Config } from '../lib/config-k6.ts';
import { apiKeyHeaders } from '../lib/auth-k6.ts';

const QUERY_SHAPE = __ENV.PERF_QUERY_SHAPE ?? 'bare';

const QUERIES: Record<string, string> = {
  bare: `
    query Articles { perfArticleList(first: 100) { edges { node { id slug } } } }
  `,
  filtered: `
    query Articles { perfArticleList(first: 100, where: { publishDate: { gt: "2020-01-01T00:00:00Z" } }) { edges { node { id slug } } } }
  `,
  relation: `
    query Articles { perfArticleList(first: 100) { edges { node { id slug author { id name } } } } }
  `,
};

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 500,
      stages: [
        { target: 50, duration: '30s' },
        { target: 100, duration: '30s' },
        { target: 250, duration: '30s' },
        { target: 500, duration: '30s' },
        { target: 1000, duration: '30s' },
        { target: 2000, duration: '30s' },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(99)<5000'],
    // The `relation` shape can saturate sooner than maxVUs accommodates;
    // fail loudly rather than silently under-counting the tail.
    dropped_iterations: ['count<100'],
  },
  tags: { scenario: 'flat', shape: QUERY_SHAPE },
};

export default function flat() {
  const cfg = loadK6Config();
  const headers = apiKeyHeaders();
  const query = QUERIES[QUERY_SHAPE];
  if (!query) {
    throw new Error(
      `Unknown PERF_QUERY_SHAPE: ${QUERY_SHAPE}. Valid: ${Object.keys(QUERIES).join(', ')}`
    );
  }

  const res = http.post(
    `${cfg.baseUrl}/api/graphql`,
    JSON.stringify({ query }),
    { headers, tags: { shape: QUERY_SHAPE } }
  );
  check(res, {
    '2xx': (r) => r.status >= 200 && r.status < 300,
  });
}
