// Scenario 2 — public-write CRUD churn for the rate-limit + write path.
// 10 VUs run interleaved create / read / delete iterations against the public
// namespace (/api/public/entries). PERF_CRUD_N controls the number of items per
// phase (default 10000). Uses Bearer API key auth — the key must carry
// content:write (create/delete), content:read (the public list read), and
// schema:read (content-type discovery). CSRF middleware bypasses Bearer-authed
// requests so no Origin threading is needed.
// Requires the perf DB seeded and a valid PERF_API_KEY in scope.
import http from 'k6/http';
import { group } from 'k6';
import { loadK6Config } from '../lib/config-k6.ts';
import { apiKeyHeaders } from '../lib/auth-k6.ts';
import {
  crudCreateLatency,
  crudReadLatency,
  crudDeleteLatency,
  intentional429s,
  unexpectedErrors,
} from '../lib/metrics-k6.ts';

const N = Number(__ENV.PERF_CRUD_N ?? '10000');
const IDENTIFIER = __ENV.PERF_CONTENT_TYPE ?? 'PerfArticle';

export const options = {
  scenarios: {
    crud: {
      executor: 'shared-iterations',
      vus: 10,
      iterations: N * 3, // create + read + delete per item
      maxDuration: '30m',
    },
  },
  tags: { scenario: 'crud' },
};

interface SetupData {
  contentTypeId: string;
  identifier: string;
}

export function setup(): SetupData {
  const cfg = loadK6Config();
  const headers = apiKeyHeaders();

  // Discover the content-type UUID via the schema export (portable=false
  // preserves real UUIDs) — a schema:read management endpoint, NOT the admin
  // content surface, so perf needs no admin-content token (#395/#257).
  const res = http.get(`${cfg.baseUrl}/api/schema/export?portable=false`, {
    headers,
  });
  const bundle = res.json() as {
    contentTypes?: Array<{ id: string | null; identifier: string }>;
  };
  const ct = (bundle.contentTypes ?? []).find(
    (t) => t.identifier === IDENTIFIER
  );
  if (!ct || !ct.id) {
    throw new Error(
      `${IDENTIFIER} content type not found in schema export — run \`pnpm perf:seed --size=1\` first`
    );
  }
  return { contentTypeId: ct.id, identifier: IDENTIFIER };
}

export default function crud(data: SetupData) {
  const cfg = loadK6Config();
  const headers = apiKeyHeaders();
  const iter = __ITER;

  // Use a simple phase calculation from __VU + __ITER — imperfect ordering,
  // but across 10 VUs × 3N iterations we hit each phase roughly equally.
  // See README for why strict phase ordering is a follow-up refinement.
  const phase = iter % 3;

  if (phase === 0) {
    group('create', () => {
      const body = {
        contentTypeId: data.contentTypeId,
        // Publish so the entry is PUBLISHED → visible to the public read list
        // (the public namespace is PUBLISHED-only). Exercises the publish path
        // + cache invalidation — the production-representative workload.
        publish: true,
        data: {
          title: `CRUD ${__VU}-${iter}-${Date.now()}`,
          slug: `crud-${__VU}-${iter}-${Date.now()}`,
          excerpt: 'CRUD cycle',
          body: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'body' }],
              },
            ],
          },
          publishDate: new Date().toISOString(),
        },
      };
      const res = http.post(
        `${cfg.baseUrl}/api/public/entries`,
        JSON.stringify(body),
        { headers, tags: { phase: 'create' } }
      );
      crudCreateLatency.add(res.timings.duration);
      if (res.status === 429) intentional429s.add(1);
      else if (res.status < 200 || res.status >= 300) unexpectedErrors.add(1);
    });
    return;
  }

  if (phase === 1) {
    group('read', () => {
      // No single-entry public read exists; the cached public LIST is the read.
      // crudReadLatency now measures the list GET (a list read, not by-id).
      const res = http.get(
        `${cfg.baseUrl}/api/public/entries?contentType=${data.identifier}&perPage=1`,
        { headers, tags: { phase: 'read' } }
      );
      crudReadLatency.add(res.timings.duration);
      if (res.status < 200 || res.status >= 300) unexpectedErrors.add(1);
    });
    return;
  }

  group('delete', () => {
    const list = http.get(
      `${cfg.baseUrl}/api/public/entries?contentType=${data.identifier}&perPage=1`,
      { headers, tags: { phase: 'list' } }
    );
    if (list.status !== 200) {
      unexpectedErrors.add(1);
      return;
    }
    const items = (list.json() as { items: Array<{ id: string }> }).items;
    if (items.length === 0) return;
    const res = http.del(
      `${cfg.baseUrl}/api/public/entries/${items[0]!.id}`,
      null,
      { headers, tags: { phase: 'delete' } }
    );
    crudDeleteLatency.add(res.timings.duration);
    if (res.status === 429) intentional429s.add(1);
    // 404 here means another VU already deleted the same head item.
    // That's a normal race under load, not an unexpected error.
    else if (res.status === 404) return;
    else if (res.status < 200 || res.status >= 300) unexpectedErrors.add(1);
  });
}
