import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { loadProjectConfig } from '../../config.js';
import { getEntriesBundle, HttpError } from '../../api.js';

const DEFAULT_OUT = 'content-entries.boject.json';

export interface EntriesExportFlags {
  out?: string;
  url?: string;
  portable?: boolean;
  includeDrafts?: boolean;
  contentType?: string;
}

export interface EntriesExportParams {
  cwd: string;
  apiKey: string | undefined;
  flags?: EntriesExportFlags;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface EntriesExportResult {
  exitCode: 0 | 1;
}

export async function runEntriesExport(
  params: EntriesExportParams
): Promise<EntriesExportResult> {
  const flags = params.flags ?? {};

  if (!params.apiKey) {
    params.stderr('Error: BOJECT_API_KEY is not set.');
    return { exitCode: 1 };
  }

  let config: Awaited<ReturnType<typeof loadProjectConfig>>;
  try {
    config = await loadProjectConfig(params.cwd);
  } catch (err) {
    params.stderr(`Error: ${(err as Error).message}`);
    return { exitCode: 1 };
  }

  const url = flags.url ?? config.config.cms.url;
  const outRel = flags.out ?? DEFAULT_OUT;
  const outAbs = isAbsolute(outRel)
    ? outRel
    : resolve(dirname(config.configPath), outRel);

  let bundle: Awaited<ReturnType<typeof getEntriesBundle>>;
  try {
    bundle = await getEntriesBundle(
      { baseUrl: url, apiKey: params.apiKey },
      {
        portable: flags.portable !== false,
        includeDrafts: flags.includeDrafts === true,
        contentType: flags.contentType,
      }
    );
  } catch (err) {
    if (err instanceof HttpError) {
      params.stderr(`Error: ${err.status} ${err.code} — ${err.message}`);
    } else {
      params.stderr(`Error: ${(err as Error).message}`);
    }
    return { exitCode: 1 };
  }

  await mkdir(dirname(outAbs), { recursive: true });
  const text = JSON.stringify(bundle, null, 2) + '\n';
  await writeFile(outAbs, text);

  const n = bundle.entries?.length ?? 0;
  params.stdout(`✓ Exported entries from ${url}`);
  params.stdout(`  ${n} entr${n === 1 ? 'y' : 'ies'}`);
  params.stdout(`  Wrote ${outAbs} (${Buffer.byteLength(text)} bytes)`);
  if (n > 0) {
    params.stdout(
      '  Note: image bytes are not included — clone your storage bucket separately.'
    );
  }
  return { exitCode: 0 };
}
