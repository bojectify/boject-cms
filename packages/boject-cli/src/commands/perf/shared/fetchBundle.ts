import type { Bundle } from '../../../vendor/contentBundleTypes.js';

/**
 * Fetches the live schema bundle from the CMS via GET /api/schema/export.
 * Used by `boject perf seed` (HTTP transport) when no `--bundle` file is
 * provided — the CLI introspects the deployed schema to know what fields
 * each content type has before synthesising values.
 */
export async function fetchBundle(opts: {
  baseUrl: string;
  apiKey: string;
}): Promise<Bundle> {
  const res = await fetch(`${opts.baseUrl}/api/schema/export`, {
    headers: { Authorization: `Bearer ${opts.apiKey}` },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `Schema export auth failed (${res.status}). Check --api-key / $BOJECT_API_KEY.`
    );
  }
  if (!res.ok) {
    throw new Error(`Schema export failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as Bundle;
}
