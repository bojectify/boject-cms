import { FIRST_API_KEY_COMMAND } from '../../vendor/scaffoldApiKey.js';
import type { DriftCheck, DriftContext } from '../types.js';

/** First non-empty BOJECT_API_KEY: shell, then .env.local, then .env. */
export async function resolveApiKey(ctx: DriftContext): Promise<string | null> {
  const candidates = [
    ctx.shellEnv.BOJECT_API_KEY,
    (await ctx.readEnvFile('.env.local'))?.BOJECT_API_KEY,
    (await ctx.readEnvFile('.env'))?.BOJECT_API_KEY,
  ];
  return candidates.find((v): v is string => !!v) ?? null;
}

export const cliApiKey: DriftCheck = {
  id: 'cli-api-key',
  appliesFrom: '0.0.3',
  severity: 'advice',
  async run(ctx) {
    const [env, envLocal] = await Promise.all([
      ctx.readEnvFile('.env'),
      ctx.readEnvFile('.env.local'),
    ]);
    if (env === null && envLocal === null) {
      return { skipped: 'no .env or .env.local found' };
    }
    if ((await resolveApiKey(ctx)) !== null) return null;
    return {
      title: 'No CLI API key (BOJECT_API_KEY) found',
      detail: [
        'The boject CLI needs an API key to talk to your CMS. Create one, then save it in .env.local.',
      ],
      snippets: [
        { file: 'terminal', text: FIRST_API_KEY_COMMAND },
        {
          file: '.env.local',
          text: 'BOJECT_API_KEY=<the key printed by the command above>',
        },
      ],
    };
  },
};
