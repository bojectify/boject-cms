import { randomBytes } from 'node:crypto';
import {
  CMS_DEPENDS_ON_LINES,
  MEILI_VOLUME_LINE,
  MEILISEARCH_SERVICE_BLOCK,
  REDIS_SERVICE_BLOCK,
  searchCacheEnvLines,
} from '../scaffoldSnippets.js';
import type { DriftCheck, DriftContext } from '../types.js';

const REQUIRED_KEYS = ['MEILI_URL', 'MEILI_MASTER_KEY', 'REDIS_URL'] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** The `environment` of services.cms, or undefined when absent. */
function cmsEnvironment(ctx: DriftContext): unknown {
  const services = ctx.compose?.services;
  if (!isRecord(services)) return undefined;
  const cms = services.cms;
  return isRecord(cms) ? cms.environment : undefined;
}

/** Keys with a non-empty value, from the map or `KEY=value` list form. */
function composeSetKeys(environment: unknown): Set<string> {
  const set = new Set<string>();
  if (Array.isArray(environment)) {
    for (const item of environment) {
      if (typeof item !== 'string') continue;
      const i = item.indexOf('=');
      if (i > 0 && item.slice(i + 1) !== '') set.add(item.slice(0, i));
    }
  } else if (isRecord(environment)) {
    for (const [k, v] of Object.entries(environment)) {
      if (v !== null && v !== undefined && String(v) !== '') set.add(k);
    }
  }
  return set;
}

export const searchAndCacheServices: DriftCheck = {
  id: 'search-and-cache-services',
  appliesFrom: '0.0.1-rc.2',
  severity: 'required',
  async run(ctx) {
    const env = await ctx.readEnvFile('.env');
    const environment = cmsEnvironment(ctx);
    if (env === null && environment === undefined) {
      return {
        skipped: "no .env found, so the search/cache keys weren't checked",
      };
    }
    const fromCompose = composeSetKeys(environment);
    const missing = REQUIRED_KEYS.filter(
      (k) => !(env?.[k] ?? '') && !fromCompose.has(k)
    );
    if (missing.length === 0) return null;

    const composeText = [
      MEILISEARCH_SERVICE_BLOCK,
      '',
      REDIS_SERVICE_BLOCK,
      '',
      `# Also add "${MEILI_VOLUME_LINE.trim()}" under the top-level volumes:`,
      '# and these under services.cms.depends_on:',
      ...CMS_DEPENDS_ON_LINES,
    ].join('\n');

    return {
      title: 'This version needs Meilisearch and Redis',
      detail: [
        `Not set in .env or services.cms.environment: ${missing.join(', ')}`,
      ],
      snippets: [
        { file: 'docker-compose.yml', text: composeText },
        {
          file: '.env',
          text: searchCacheEnvLines(
            missing,
            randomBytes(32).toString('hex')
          ).join('\n'),
        },
      ],
    };
  },
};
