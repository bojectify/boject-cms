import { revokeApiKey, HttpError } from '../../api.js';
import { loadProjectConfig } from '../../config.js';

const PREFIX_PATTERN = /^boject_[a-f0-9]{4}$/;

export interface ApikeyRevokeFlags {
  prefix?: string;
  url?: string;
}

export interface ApikeyRevokeParams {
  cwd: string;
  apiKey: string | undefined;
  flags: ApikeyRevokeFlags;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface ApikeyRevokeResult {
  exitCode: 0 | 1;
}

export async function runApikeyRevoke(
  params: ApikeyRevokeParams
): Promise<ApikeyRevokeResult> {
  const { flags, stdout, stderr } = params;

  if (!flags.prefix) {
    stderr('Error: prefix is required.');
    return { exitCode: 1 };
  }
  if (!PREFIX_PATTERN.test(flags.prefix)) {
    stderr('Error: Invalid prefix shape. Expected `boject_xxxx` (11 chars).');
    return { exitCode: 1 };
  }
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
    await revokeApiKey({ baseUrl, apiKey: params.apiKey }, flags.prefix);
    stdout(`Revoked API key (${flags.prefix}).`);
    return { exitCode: 0 };
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.code === 'APIKEY_NOT_FOUND') {
        stderr(
          `Error: No active API key found with prefix "${flags.prefix}". Run \`boject apikey list\` to see available keys.`
        );
      } else if (err.code === 'INSUFFICIENT_SCOPE') {
        stderr(
          'Error: Your API key needs `apikey:write` scope to revoke keys.'
        );
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
