import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { loadProjectConfig } from '../../config.js';
import { getSchemaBundle, HttpError } from '../../api.js';

export interface SchemaPullFlags {
  out?: string;
  url?: string;
}

export interface SchemaPullParams {
  cwd: string;
  apiKey: string | undefined;
  flags?: SchemaPullFlags;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface SchemaPullResult {
  exitCode: 0 | 1;
}

export async function runSchemaPull(
  params: SchemaPullParams
): Promise<SchemaPullResult> {
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
  const outRel = flags.out ?? config.config.schema.path;
  const outAbs = isAbsolute(outRel)
    ? outRel
    : resolve(dirname(config.configPath), outRel);

  let bundle: Awaited<ReturnType<typeof getSchemaBundle>>;
  try {
    bundle = await getSchemaBundle({ baseUrl: url, apiKey: params.apiKey });
  } catch (err) {
    if (err instanceof HttpError) {
      params.stderr(`Error: ${err.status} ${err.code} — ${err.message}`);
    } else {
      params.stderr(`Error: ${(err as Error).message}`);
    }
    return { exitCode: 1 };
  }

  await mkdir(dirname(outAbs), { recursive: true });
  const body = JSON.stringify(bundle, null, 2) + '\n';
  await writeFile(outAbs, body);

  const types = bundle.contentTypes?.length ?? 0;
  const fields =
    bundle.contentTypes?.reduce((sum, ct) => sum + ct.fields.length, 0) ?? 0;
  params.stdout(`✓ Pulled schema from ${url}`);
  params.stdout(
    `  ${types} content type${types === 1 ? '' : 's'}, ${fields} field${fields === 1 ? '' : 's'}`
  );
  params.stdout(`  Wrote ${outAbs} (${Buffer.byteLength(body)} bytes)`);
  return { exitCode: 0 };
}
