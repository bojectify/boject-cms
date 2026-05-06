// Scenario 1B — GraphQL flat-RPS ramp.
// Drives the cms's GraphQL endpoint at increasing arrival rates to find
// the failure point. PERF_QUERY_SHAPE selects a query template:
//   - bare: small projection, no joins
//   - filtered: with a DATETIME filter (exercises JSONB index path)
//   - relation: includes a RELATION (exercises sub-resolver)
// Requires the perf DB seeded and PERF_API_KEY exported.
//
// Content-type identifiers default to the internal PerfArticle/Author
// fixture so `pnpm perf:sweep` keeps working unchanged. The CLI
// (#126) overrides them via PERF_LIST_FIELD / PERF_FILTER_FIELD /
// PERF_RELATION_FIELD when running against an operator's schema.
import http from 'k6/http';
import { check } from 'k6';
import { loadK6Config } from '../lib/config-k6.ts';
import { apiKeyHeaders } from '../lib/auth-k6.ts';

const QUERY_SHAPE = __ENV.PERF_QUERY_SHAPE ?? 'bare';
const LIST_FIELD = __ENV.PERF_LIST_FIELD ?? 'perfArticleList';
const FILTER_FIELD = __ENV.PERF_FILTER_FIELD ?? 'publishDate';
const RELATION_FIELD = __ENV.PERF_RELATION_FIELD ?? 'author';

const QUERIES: Record<string, string> = {
  bare: `query Items { ${LIST_FIELD}(first: 100) { edges { node { id } } } }`,
  filtered: `query Items { ${LIST_FIELD}(first: 100, where: { ${FILTER_FIELD}: { gt: "2020-01-01T00:00:00Z" } }) { edges { node { id } } } }`,
  relation: `query Items { ${LIST_FIELD}(first: 100) { edges { node { id ${RELATION_FIELD} { id } } } } }`,
};

export const options = {
  scenarios: {
    flat: {
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
    dropped_iterations: ['count<100'],
  },
  tags: { shape: QUERY_SHAPE },
};

export default function flat() {
  const cfg = loadK6Config();
  const headers = apiKeyHeaders();
  const query = QUERIES[QUERY_SHAPE];
  if (!query) {
    throw new Error(
      `Unknown PERF_QUERY_SHAPE: ${QUERY_SHAPE}. Valid: ${Object.keys(
        QUERIES
      ).join(', ')}`
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
