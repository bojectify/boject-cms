import { introspectContentType } from './introspect.js';
import { probeContentWriteScope } from './probeContentWriteScope.js';
import { sanitiseUrl } from './sanitise.js';

export interface PreflightParams {
  url: string;
  apiKey: string;
  contentTypeIdentifier: string;
  filterFieldOverride?: string;
  relationFieldOverride?: string;
  k6Available: () => Promise<boolean>;
  fetchHealth: (
    url: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  requireContentWrite?: boolean;
  probeContentWrite?: typeof probeContentWriteScope;
}

export interface PreflightFields {
  listField: string;
  filterField: string | null;
  relationField: string | null;
}

export type PreflightResult =
  | { ok: true; fields: PreflightFields; warnings: string[] }
  | { ok: false; errors: string[] };

export async function runPreflight(
  params: PreflightParams
): Promise<PreflightResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!(await params.k6Available())) {
    errors.push(
      'k6 is not on PATH. Install k6: `brew install k6` (macOS), `apt install k6` (Debian/Ubuntu), or see https://k6.io/docs/get-started/installation/'
    );
  }

  const health = await params.fetchHealth(params.url);
  if (!health.ok) {
    errors.push(
      `Target unreachable at ${sanitiseUrl(params.url)} — ${health.error}`
    );
  }

  // Short-circuit before hitting GraphQL if the basics aren't right.
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const intro = await introspectContentType({
    url: params.url,
    apiKey: params.apiKey,
    contentTypeIdentifier: params.contentTypeIdentifier,
  });
  if (!intro.ok) {
    return { ok: false, errors: [intro.error] };
  }

  let filterField: string | null = null;
  if (params.filterFieldOverride) {
    if (!intro.datetimeFields.includes(params.filterFieldOverride)) {
      errors.push(
        `--filter-field "${params.filterFieldOverride}" is not a DATETIME field on ${params.contentTypeIdentifier}. Available: ${intro.datetimeFields.join(', ') || '(none)'}`
      );
    } else {
      filterField = params.filterFieldOverride;
    }
  } else if (intro.datetimeFields.length > 0) {
    filterField = intro.datetimeFields[0]!;
  } else {
    warnings.push(
      `No DATETIME field on ${params.contentTypeIdentifier} — "filtered" shape will be skipped.`
    );
  }

  let relationField: string | null = null;
  if (params.relationFieldOverride) {
    if (
      !intro.singleTargetRelationFields.includes(params.relationFieldOverride)
    ) {
      errors.push(
        `--relation-field "${params.relationFieldOverride}" is not a single-target RELATION field on ${params.contentTypeIdentifier}. Available: ${intro.singleTargetRelationFields.join(', ') || '(none)'}`
      );
    } else {
      relationField = params.relationFieldOverride;
    }
  } else if (intro.singleTargetRelationFields.length > 0) {
    relationField = intro.singleTargetRelationFields[0]!;
  } else {
    warnings.push(
      `No single-target RELATION field on ${params.contentTypeIdentifier} — "relation" shape will be skipped.`
    );
  }

  if (params.requireContentWrite) {
    const probe = params.probeContentWrite ?? probeContentWriteScope;
    const result = await probe({ baseUrl: params.url, apiKey: params.apiKey });
    if (!result.ok) {
      if ('missingScope' in result) {
        errors.push(
          `API key missing required scope "${result.missingScope}". ` +
            `Mint a new key with: boject apikey create --scopes content:write,content:read`
        );
      } else {
        errors.push(`Could not verify content:write scope: ${result.error}`);
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    fields: { listField: intro.listField, filterField, relationField },
    warnings,
  };
}
