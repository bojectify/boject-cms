// Scenario 1A — GraphQL cursor-paginated sitemap drain.
// Each VU drains every PerfArticle once via perfArticleList; PERF_VUS
// scales concurrent read load, NOT parallel partitioning. Requires the
// perf DB to be pre-seeded (`pnpm perf:seed --size=N`) and the perf API
// key present (`SEED_PERF_KEY=1 pnpm prisma:seed` once per fresh DB).
import http, { type RefinedResponse, type ResponseType } from 'k6/http';
import { check, fail } from 'k6';
import { loadK6Config } from '../lib/config-k6';
import { apiKeyHeaders } from '../lib/auth-k6';
import { drainLatency, drainWallClock } from '../lib/metrics-k6';

const PAGE_SIZE = Number(__ENV.PERF_PAGE_SIZE ?? '100');
const VUS = Number(__ENV.PERF_VUS ?? '1');

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
  query Articles($first: Int!, $after: String) {
    perfArticleList(first: $first, after: $after) {
      edges { node { id slug updatedAt } cursor }
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
            data?: { perfArticleList?: { pageInfo?: unknown } };
          };
          return Boolean(j.data?.perfArticleList?.pageInfo);
        } catch {
          return false;
        }
      },
    });
    if (!ok) fail(`GraphQL page request failed: ${res.status}`);
    drainLatency.add(res.timings.duration);
    const page = (
      res.json() as {
        data: {
          perfArticleList: {
            pageInfo: { endCursor: string | null; hasNextPage: boolean };
          };
        };
      }
    ).data.perfArticleList.pageInfo;
    pages++;
    if (!page.hasNextPage) break;
    cursor = page.endCursor;
  }

  drainWallClock.add(Date.now() - start);
  console.log(`sitemap VU drained ${pages} pages in ${Date.now() - start}ms`);
}
