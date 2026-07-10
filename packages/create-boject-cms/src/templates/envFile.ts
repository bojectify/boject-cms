// A runtime-derived starter set can't be a compile-time union — the set of
// valid names comes from the filesystem (see src/starters.ts). `none` stays
// a runtime sentinel meaning "no starter". Invalid names are now caught at
// runtime (wizard validation, copyStarters ENOENT, tests) rather than by tsc.
export type StarterChoice = string;

export interface EnvFileParams {
  sessionPassword: string;
  adminPassword: string;
  meiliMasterKey: string;
  starter: StarterChoice;
  hostPort: number;
}

export function renderEnvFile({
  sessionPassword,
  adminPassword,
  meiliMasterKey,
  starter,
  hostPort,
}: EnvFileParams): string {
  const lines = [
    'DATABASE_URL=postgresql://boject:boject@db:5432/boject',
    '# Search (Meilisearch) + cache (Redis) sidecars — see docker-compose.yml.',
    'MEILI_URL=http://meilisearch:7700',
    `MEILI_MASTER_KEY=${meiliMasterKey}`,
    'REDIS_URL=redis://redis:6379',
    `NUXT_SESSION_PASSWORD=${sessionPassword}`,
    'BOJECT_ADMIN_EMAIL=admin@local',
    `BOJECT_ADMIN_PASSWORD=${adminPassword}`,
    'STORAGE_DRIVER=local',
    'BOJECT_SCHEMA_DIR=/app/content-types',
  ];
  if (starter !== 'none') {
    lines.push(`BOJECT_INITIAL_STARTER=/starters/${starter}.boject.json`);
  }
  lines.push(
    '',
    '# Host port the CMS is published on (mapped to the container port 3000).',
    '# Change it to run several projects side by side, or to avoid a port clash.',
    `BOJECT_HOST_PORT=${hostPort}`,
    '',
    '# Set to "true" on production / staging to disable schema editing in the UI.',
    '# Schema changes should flow from git on locked environments.',
    '# BOJECT_SCHEMA_READONLY=true',
    '',
    '# Allow destructive schema changes (removing content types or fields)',
    '# during the every-boot apply. Default off — only additive changes apply',
    '# automatically. Flip this on for environments where bundle removals are',
    '# expected to take effect.',
    '# BOJECT_ALLOW_DESTRUCTIVE_SCHEMA=true',
    '',
    '# ── Performance / rate-limit / cache tuning ─────────────────────────────',
    '# All optional. The values shown are the built-in defaults, so leaving',
    '# these commented changes nothing. Uncomment and edit a line to override;',
    '# the CMS reads them from the environment at runtime, so no image rebuild',
    '# is needed — restart the container to pick up a change.',
    '',
    '# Max cost of a single GraphQL query before it is rejected as too complex.',
    '# BOJECT_GRAPHQL_COMPLEXITY_MAX_COST=1000',
    '# Compute + log over-cap queries instead of rejecting them — the safe way to',
    '# roll out a lower cap before enforcing it.',
    '# BOJECT_GRAPHQL_COMPLEXITY_LOG_ONLY=true',
    '# Per-key GraphQL rate limit, requests per second.',
    '# GRAPHQL_RATE_LIMIT_RPS=1000',
    '# Max size (bytes) of a cached GraphQL response; larger responses skip the',
    '# cache rather than evict the working set.',
    '# BOJECT_GRAPHQL_CACHE_MAX_BYTES=1048576',
    '',
    '# Per-key rate limits, requests per minute (IP fallback for session users):',
    '#   GET /api/search',
    '# BOJECT_SEARCH_RATE_LIMIT_RPM=120',
    '#   GET /api/public/entries (reads)',
    '# BOJECT_PUBLIC_RATE_LIMIT_RPM=120',
    '#   POST/PUT/PATCH/DELETE /api/public/entries (writes)',
    '# BOJECT_PUBLIC_WRITE_RATE_LIMIT_RPM=120',
    '',
    '# Public read cache TTL, in seconds.',
    '# BOJECT_PUBLIC_CACHE_TTL=3600',
    '',
    '# Number of trusted reverse proxies in front of the app. The default 0',
    '# ignores the spoofable X-Forwarded-For header and rate-limits on the',
    '# socket peer IP. Behind a proxy or load balancer, set this to the real',
    '# hop count — otherwise every request is attributed to the proxy IP and',
    '# shares a single rate-limit bucket.',
    '# BOJECT_TRUSTED_PROXY_HOPS=0',
    '',
    '# Set when using the boject CLI (`boject schema pull/apply/check`).',
    '# Create one with: pnpm apikey:create cli --scopes schema:read,schema:write',
    '# BOJECT_API_KEY='
  );
  return lines.join('\n') + '\n';
}
