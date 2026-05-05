import { API_KEY_SCOPES, isApiKeyScope } from '../../vendor/apiKeyScopes.js';
import { createApiKey, HttpError } from '../../api.js';
import { loadProjectConfig } from '../../config.js';

export interface ApikeyCreateFlags {
  name?: string;
  scopes?: string;
  url?: string;
}

export interface ApikeyCreateParams {
  cwd: string;
  apiKey: string | undefined;
  flags: ApikeyCreateFlags;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface ApikeyCreateResult {
  exitCode: 0 | 1;
}

export async function runApikeyCreate(
  params: ApikeyCreateParams
): Promise<ApikeyCreateResult> {
  const { flags, stdout, stderr } = params;

  if (!flags.name || flags.name.trim().length === 0) {
    stderr('Error: --name is required.');
    return { exitCode: 1 };
  }

  if (!flags.scopes || flags.scopes.trim().length === 0) {
    stderr(
      `Error: --scopes is required. Recognised: ${API_KEY_SCOPES.join(', ')}.`
    );
    return { exitCode: 1 };
  }

  const scopes = flags.scopes
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const s of scopes) {
    if (!isApiKeyScope(s)) {
      stderr(
        `Error: Unknown scope "${s}". Recognised: ${API_KEY_SCOPES.join(', ')}.`
      );
      return { exitCode: 1 };
    }
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

  const ctx = { baseUrl, apiKey: params.apiKey };
  try {
    const result = await createApiKey(ctx, {
      name: flags.name.trim(),
      scopes,
    });
    stdout('API key created.');
    stdout('');
    stdout(`  Name:   ${result.name}`);
    stdout(`  Prefix: ${result.prefix}`);
    stdout(`  Scopes: ${result.scopes.join(', ')}`);
    stdout(`  Key:    ${result.rawKey}`);
    stdout('');
    stdout('Save this key now — it cannot be retrieved again.');
    return { exitCode: 0 };
  } catch (err) {
    if (err instanceof HttpError) {
      switch (err.code) {
        case 'APIKEY_WRITE_REQUIRES_SESSION':
          stderr(
            'Error: Minting an apikey:write key requires session auth — use the CMS UI or the `pnpm apikey:create` recovery script.'
          );
          break;
        case 'INSUFFICIENT_SCOPE':
          stderr(
            'Error: Your API key needs `apikey:write` scope to create keys.'
          );
          break;
        case 'UNKNOWN_SCOPE':
          stderr(`Error: ${err.message}`);
          break;
        default:
          if (err.status === 401) {
            stderr('Error: Invalid or revoked API key.');
          } else {
            stderr(`Error: ${err.message}`);
          }
      }
      return { exitCode: 1 };
    }
    stderr(`Error: ${(err as Error).message}`);
    return { exitCode: 1 };
  }
}
