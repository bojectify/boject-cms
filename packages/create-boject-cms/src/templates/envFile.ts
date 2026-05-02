export type StarterChoice = 'base' | 'sport' | 'rugby' | 'none';

export interface EnvFileParams {
  sessionPassword: string;
  adminPassword: string;
  starter: StarterChoice;
}

export function renderEnvFile({
  sessionPassword,
  adminPassword,
  starter,
}: EnvFileParams): string {
  const lines = [
    'DATABASE_URL=postgresql://boject:boject@db:5432/boject',
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
    '# Set to "true" on production / staging to disable schema editing in the UI.',
    '# Schema changes should flow from git on locked environments.',
    '# BOJECT_SCHEMA_READONLY=true',
    '',
    '# Allow destructive schema changes (removing content types or fields)',
    '# during the every-boot apply. Default off — only additive changes apply',
    '# automatically. Flip this on for environments where bundle removals are',
    '# expected to take effect.',
    '# BOJECT_ALLOW_DESTRUCTIVE_SCHEMA=true'
  );
  return lines.join('\n') + '\n';
}
