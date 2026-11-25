/**
 * Snippets a project scaffolded by create-boject-cms is expected to carry.
 * The service blocks are copies of the ones in
 * packages/create-boject-cms/src/templates/dockerCompose.ts; the
 * scaffoldSnippets test asserts they stay in step.
 */

export const MEILISEARCH_SERVICE_BLOCK = `  meilisearch:
    image: getmeili/meilisearch:v1.45.2
    restart: unless-stopped
    environment:
      # Production mode: all routes require the master key. The CMS reads the
      # same key from .env (MEILI_MASTER_KEY). Compose interpolates it here.
      MEILI_ENV: production
      MEILI_MASTER_KEY: \${MEILI_MASTER_KEY}
      MEILI_NO_ANALYTICS: 'true'
    volumes:
      # The search index must survive restarts, else search is empty until a
      # manual \`pnpm search:reindex\`.
      - meilidata:/meili_data`;

export const REDIS_SERVICE_BLOCK = `  redis:
    image: redis:7.4-alpine
    restart: unless-stopped
    # Cache only — no persistence, no volume. Restarts cold by design
    # (repopulates from Postgres).
    command: redis-server --save "" --appendonly no`;

export const MEILI_VOLUME_LINE = '  meilidata:';

export const CMS_DEPENDS_ON_LINES = ['      - meilisearch', '      - redis'];

const MEILI_URL_LINE = 'MEILI_URL=http://meilisearch:7700';
const REDIS_URL_LINE = 'REDIS_URL=redis://redis:6379';

/** `.env` lines for only the missing keys, in a fixed order. */
export function searchCacheEnvLines(
  missing: readonly string[],
  meiliKey: string
): string[] {
  const lines: Array<[string, string]> = [
    ['MEILI_URL', MEILI_URL_LINE],
    ['MEILI_MASTER_KEY', `MEILI_MASTER_KEY=${meiliKey}`],
    ['REDIS_URL', REDIS_URL_LINE],
  ];
  return lines.filter(([key]) => missing.includes(key)).map(([, l]) => l);
}

export function releaseNotesUrl(version: string): string {
  return `https://github.com/bojectify/boject-cms/releases/tag/v${version}`;
}
