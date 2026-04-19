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
  ];
  if (starter !== 'none') {
    lines.push(`BOJECT_INITIAL_STARTER=/starters/${starter}.boject.json`);
  }
  return lines.join('\n') + '\n';
}
