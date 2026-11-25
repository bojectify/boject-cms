import type { DriftCheck } from '../types.js';
import { resolveApiKey } from './cliApiKey.js';

const PREFIX_LENGTH = 11;

export const staleBootstrapKey: DriftCheck = {
  id: 'stale-bootstrap-key',
  appliesFrom: null,
  severity: 'warning',
  async run(ctx) {
    const env = await ctx.readEnvFile('.env');
    if (env === null) return { skipped: 'no .env found' };
    const bootstrap = env.BOJECT_BOOTSTRAP_API_KEY;
    if (!bootstrap) return null;
    const apiKey = await resolveApiKey(ctx);
    if (apiKey === null) return null;

    const bootstrapPrefix = bootstrap.split(':')[0].slice(0, PREFIX_LENGTH);
    const keyPrefix = apiKey.slice(0, PREFIX_LENGTH);
    if (bootstrapPrefix === keyPrefix) return null;

    return {
      title: 'BOJECT_BOOTSTRAP_API_KEY points at a different key',
      detail: [
        `BOJECT_BOOTSTRAP_API_KEY in .env refers to key \`${bootstrapPrefix}\`, but your CLI uses \`${keyPrefix}\`.`,
        "If you've rotated the key, remove BOJECT_BOOTSTRAP_API_KEY and BOJECT_BOOTSTRAP_API_KEY_SCOPES from .env, or a database reset will bring the old key back.",
      ],
      snippets: [],
      notesVersion: null,
    };
  },
};
