import { readFile } from 'node:fs/promises';
import { resolve, dirname, isAbsolute } from 'node:path';
import { loadProjectConfig } from '../../config.js';
import { validateBundle } from '../../vendor/validateBundle.js';
import { planSchema } from '../../vendor/planSchema.js';
import type { Bundle } from '../../vendor/contentBundleTypes.js';
import type { CurrentSchemaSnapshot } from '../../vendor/schemaPlan.types.js';

export interface SchemaValidateParams {
  cwd?: string;
  path?: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface SchemaValidateResult {
  exitCode: 0 | 1;
}

const EMPTY_SNAPSHOT: CurrentSchemaSnapshot = {
  contentTypes: [],
  fieldUsage: new Map(),
};

export async function runSchemaValidate(
  params: SchemaValidateParams
): Promise<SchemaValidateResult> {
  let path = params.path;
  if (!path) {
    if (!params.cwd) {
      params.stderr(
        'Error: pass a path or run from inside a project with .boject.config.json'
      );
      return { exitCode: 1 };
    }
    let config: Awaited<ReturnType<typeof loadProjectConfig>>;
    try {
      config = await loadProjectConfig(params.cwd);
    } catch (err) {
      params.stderr(`Error: ${(err as Error).message}`);
      return { exitCode: 1 };
    }
    path = isAbsolute(config.config.schema.path)
      ? config.config.schema.path
      : resolve(dirname(config.configPath), config.config.schema.path);
  }

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    params.stderr(`Error reading ${path}: ${(err as Error).message}`);
    return { exitCode: 1 };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    params.stderr(`Error parsing ${path}: ${(err as Error).message}`);
    return { exitCode: 1 };
  }

  const v = validateBundle(parsed as Bundle);
  if (!v.ok) {
    params.stderr('✗ Bundle invalid');
    for (const e of v.errors) {
      params.stderr(`  - ${e.path}: ${e.message}`);
    }
    return { exitCode: 1 };
  }

  const plan = planSchema(parsed as Bundle, EMPTY_SNAPSHOT, {});
  if (plan.blockers.length > 0) {
    params.stderr('✗ Bundle invalid');
    for (const b of plan.blockers) {
      params.stderr(`  - ${b.code} at ${b.path}: ${b.message}`);
    }
    return { exitCode: 1 };
  }

  const bundle = parsed as Bundle;
  const types = bundle.contentTypes?.length ?? 0;
  const fields =
    bundle.contentTypes?.reduce((sum, ct) => sum + ct.fields.length, 0) ?? 0;
  params.stdout(`✓ Bundle valid`);
  params.stdout(
    `  ${types} content type${types === 1 ? '' : 's'}, ${fields} field${fields === 1 ? '' : 's'}, 0 cross-reference issues`
  );
  return { exitCode: 0 };
}
