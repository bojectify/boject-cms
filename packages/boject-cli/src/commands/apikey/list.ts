import { listApiKeys, HttpError } from '../../api.js';
import { loadProjectConfig } from '../../config.js';
import type { ApiKeyListItem } from '../../types.js';

export interface ApikeyListFlags {
  url?: string;
  json?: boolean;
}

export interface ApikeyListParams {
  cwd: string;
  apiKey: string | undefined;
  flags: ApikeyListFlags;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface ApikeyListResult {
  exitCode: 0 | 1;
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function formatTimestamp(iso: string | null): string {
  return iso ? iso.slice(0, 19) : 'Never';
}

function statusOf(item: ApiKeyListItem): string {
  return item.revokedAt ? 'REVOKED' : 'ACTIVE';
}

export async function runApikeyList(
  params: ApikeyListParams
): Promise<ApikeyListResult> {
  const { stdout, stderr, flags } = params;

  if (!params.apiKey) {
    stderr('Error: BOJECT_API_KEY is not set.');
    return { exitCode: 1 };
  }

  let baseUrl: string;
  if (flags.url) {
    baseUrl = flags.url;
  } else {
    try {
      const loaded = await loadProjectConfig(params.cwd);
      baseUrl = loaded.config.cms.url;
    } catch (err) {
      stderr(`Error: ${(err as Error).message}`);
      return { exitCode: 1 };
    }
  }

  try {
    const { items } = await listApiKeys({ baseUrl, apiKey: params.apiKey });
    if (flags.json) {
      stdout(JSON.stringify({ items }, null, 2));
      return { exitCode: 0 };
    }
    if (items.length === 0) {
      stdout('No API keys found.');
      return { exitCode: 0 };
    }
    stdout(
      pad('Prefix', 14) +
        pad('Name', 24) +
        pad('Status', 10) +
        pad('Scopes', 34) +
        pad('Last Used', 22) +
        'Created'
    );
    stdout('-'.repeat(118));
    for (const item of items) {
      stdout(
        pad(item.prefix, 14) +
          pad(item.name, 24) +
          pad(statusOf(item), 10) +
          pad(item.scopes.join(',') || '(none)', 34) +
          pad(formatTimestamp(item.lastUsedAt), 22) +
          formatTimestamp(item.createdAt)
      );
    }
    return { exitCode: 0 };
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.code === 'INSUFFICIENT_SCOPE') {
        stderr('Error: Your API key needs `apikey:read` scope to list keys.');
      } else if (err.status === 401) {
        stderr('Error: Invalid or revoked API key.');
      } else {
        stderr(`Error: ${err.message}`);
      }
      return { exitCode: 1 };
    }
    stderr(`Error: ${(err as Error).message}`);
    return { exitCode: 1 };
  }
}
