import { join } from 'node:path';
import { readComposeImage } from '../compose.js';
import { createDriftContext } from '../drift/context.js';
import { DRIFT_CHECKS } from '../drift/checks/index.js';
import { renderDriftReport } from '../drift/render.js';
import { runDriftChecks, toDriftVersion } from '../drift/runDriftChecks.js';
import { DRIFT_SEVERITIES } from '../drift/types.js';
import { parseImageRef } from '../registry.js';

export interface DoctorParams {
  cwd: string;
  shellEnv: Readonly<Record<string, string | undefined>>;
  flags?: { json?: boolean; strict?: boolean };
  isGitIgnored?: (path: string, root: string) => Promise<boolean | null>;
}

export interface DoctorResult {
  exitCode: 0 | 1;
  output: string;
  /** True when `output` is an error message (stderr), not the report. */
  error?: boolean;
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

/** Read-only: inspects the project and reports drift; never writes a file. */
export async function runDoctor(params: DoctorParams): Promise<DoctorResult> {
  const { cwd, shellEnv, flags = {}, isGitIgnored } = params;

  let image: string;
  try {
    image = await readComposeImage(join(cwd, 'docker-compose.yml'));
  } catch (error) {
    if (isEnoent(error)) {
      return {
        exitCode: 1,
        error: true,
        output: `No docker-compose.yml in ${cwd} — run boject doctor from your project directory.`,
      };
    }
    throw error;
  }

  const tag = parseImageRef(image).tag;
  const version = toDriftVersion(tag);
  const ctx = await createDriftContext({
    root: cwd,
    version,
    shellEnv,
    isGitIgnored,
  });
  const report = await runDriftChecks(ctx, DRIFT_CHECKS);

  const blocking = report.findings.some(
    (f) =>
      f.severity === DRIFT_SEVERITIES.required ||
      f.severity === DRIFT_SEVERITIES.warning
  );
  const exitCode =
    blocking || (flags.strict === true && report.findings.length > 0) ? 1 : 0;

  if (flags.json === true) {
    return {
      exitCode,
      output: JSON.stringify(
        {
          version: report.version,
          tag,
          findings: report.findings,
          skipped: report.skipped,
        },
        null,
        2
      ),
    };
  }

  const lines = renderDriftReport(report);
  if (report.findings.length === 0) {
    lines.push(`No drift found for ${tag}.`);
  } else if (!blocking) {
    lines.push('', `No problems found for ${tag} (advice above).`);
  }
  return { exitCode, output: lines.join('\n') };
}
