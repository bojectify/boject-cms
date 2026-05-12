import { runPreflight } from '../../perf/preflight.js';
import { loadProjectConfig } from '../../config.js';
import { defaultK6Available, defaultFetchHealth } from '../../perf/runtime.js';

export interface PerfCheckFlags {
  url?: string;
  apiKey?: string;
  contentType?: string;
  filterField?: string;
  relationField?: string;
}

export interface PerfCheckParams {
  cwd: string;
  apiKey: string | undefined;
  flags?: PerfCheckFlags;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface PerfCheckResult {
  exitCode: 0 | 1 | 2 | 3;
}

export async function runPerfCheck(
  params: PerfCheckParams
): Promise<PerfCheckResult> {
  const flags = params.flags ?? {};

  // Try to read defaults from .boject.config.json (non-fatal if absent).
  let configContentType: string | undefined;
  let configUrl: string | undefined;
  let configFilter: string | undefined;
  let configRelation: string | undefined;
  try {
    const c = await loadProjectConfig(params.cwd);
    configUrl = c.config.cms.url;
    configContentType = c.config.perf?.contentType;
    configFilter = c.config.perf?.filterField;
    configRelation = c.config.perf?.relationField;
  } catch (err) {
    const message = (err as Error).message;
    // "No .boject.config.json found ..." is fine — flags can supply everything.
    // Anything else is a real config error and must be surfaced as a warning
    // (we don't fail the command — flags may still cover all required values).
    if (!message.startsWith('No .boject.config.json found')) {
      params.stderr(`Warning: ignoring config: ${message}`);
    }
  }

  const url = flags.url ?? configUrl;
  const apiKey = flags.apiKey ?? params.apiKey;
  const contentType = flags.contentType ?? configContentType;

  if (!apiKey) {
    params.stderr(
      'Error: API key missing. Set BOJECT_API_KEY or pass --api-key. Mint with `boject apikey create --scopes content:read`.'
    );
    return { exitCode: 2 };
  }
  if (!url) {
    params.stderr(
      'Error: --url not provided and no .boject.config.json found.'
    );
    return { exitCode: 2 };
  }
  if (!contentType) {
    params.stderr(
      'Error: --content-type is required (or set perf.contentType in .boject.config.json).'
    );
    return { exitCode: 3 };
  }

  const result = await runPreflight({
    url,
    apiKey,
    contentTypeIdentifier: contentType,
    filterFieldOverride: flags.filterField ?? configFilter,
    relationFieldOverride: flags.relationField ?? configRelation,
    k6Available: defaultK6Available,
    fetchHealth: defaultFetchHealth,
  });

  if (!result.ok) {
    for (const e of result.errors) params.stderr(`Error: ${e}`);
    return { exitCode: 2 };
  }
  params.stdout('Preflight OK ✓');
  params.stdout(`  list field:     ${result.fields.listField}`);
  params.stdout(
    `  filter field:   ${result.fields.filterField ?? '(no DATETIME — filtered shape will be skipped)'}`
  );
  params.stdout(
    `  relation field: ${result.fields.relationField ?? '(no single-target RELATION — relation shape will be skipped)'}`
  );
  for (const w of result.warnings) params.stdout(`  warning: ${w}`);
  return { exitCode: 0 };
}
