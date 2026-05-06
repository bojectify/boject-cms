// Scenario 1A — GraphQL cursor-paginated sitemap drain.
// Each VU drains every entry of the chosen content type via {camelName}List.
// PERF_VUS scales concurrent read load, NOT parallel partitioning.
// Requires the perf DB pre-seeded (`pnpm perf:seed --size=N`) and the
// perf API key present (`SEED_PERF_KEY=1 pnpm prisma:seed` once per
// fresh DB).
//
// PERF_LIST_FIELD overrides the list field name (default
// `perfArticleList` keeps the internal harness unchanged). The CLI
// (#126) sets this to the operator's content-type list field.
import http, { type RefinedResponse, type ResponseType } from 'k6/http';
import { check, fail } from 'k6';
import { loadK6Config } from '../lib/config-k6.ts';
import { apiKeyHeaders } from '../lib/auth-k6.ts';
import { drainLatency, drainWallClock } from '../lib/metrics-k6.ts';

const PAGE_SIZE = Number(__ENV.PERF_PAGE_SIZE ?? '100');
const VUS = Number(__ENV.PERF_VUS ?? '1');
const LIST_FIELD = __ENV.PERF_LIST_FIELD ?? 'perfArticleList';

export const options = {
  scenarios: {
    sitemap: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: 1,
      maxDuration: '10m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    perf_drain_page_ms: ['p(99)<2000'],
  },
  tags: {
    scenario: 'sitemap',
    page_size: String(PAGE_SIZE),
    vus: String(VUS),
  },
};

const QUERY = `
  query Items($first: Int!, $after: String) {
    ${LIST_FIELD}(first: $first, after: $after) {
      edges { node { id } cursor }
      pageInfo { endCursor hasNextPage }
    }
  }
`;

export default function sitemap() {
  const cfg = loadK6Config();
  const headers = apiKeyHeaders();

  let cursor: string | null = null;
  let pages = 0;
  const start = Date.now();

  while (true) {
    const res: RefinedResponse<ResponseType | undefined> = http.post(
      `${cfg.baseUrl}/api/graphql`,
      JSON.stringify({
        query: QUERY,
        variables: { first: PAGE_SIZE, after: cursor },
      }),
      { headers, tags: { phase: 'drain' } }
    );
    const ok = check(res, {
      'page 200': (r) => r.status === 200,
      'has data': (r) => {
        try {
          const j = r.json() as {
            data?: Record<string, { pageInfo?: unknown } | undefined>;
          };
          return Boolean(j.data?.[LIST_FIELD]?.pageInfo);
        } catch {
          return false;
        }
      },
    });
    if (!ok) fail(`GraphQL page request failed: ${res.status}`);
    drainLatency.add(res.timings.duration);
    const page = (
      res.json() as {
        data: Record<
          string,
          { pageInfo: { endCursor: string | null; hasNextPage: boolean } }
        >;
      }
    ).data[LIST_FIELD]!.pageInfo;
    pages++;
    if (!page.hasNextPage) break;
    cursor = page.endCursor;
  }

  drainWallClock.add(Date.now() - start);
  console.log(`sitemap VU drained ${pages} pages in ${Date.now() - start}ms`);
}
