export type StarterChoice = 'base' | 'sport' | 'rugby' | 'none';

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
    '# Set when using the boject CLI (`boject schema pull/apply/check`).',
    '# Create one with: pnpm apikey:create cli --scopes schema:read,schema:write',
    '# BOJECT_API_KEY='
  );
  return lines.join('\n') + '\n';
}
