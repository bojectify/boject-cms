import semver from 'semver';
import { DRIFT_SEVERITIES } from './types.js';
import type {
  DriftCheck,
  DriftContext,
  DriftFinding,
  DriftReport,
  DriftSeverity,
} from './types.js';

const SEVERITY_RANK: Record<DriftSeverity, number> = {
  [DRIFT_SEVERITIES.required]: 0,
  [DRIFT_SEVERITIES.warning]: 1,
  [DRIFT_SEVERITIES.advice]: 2,
};

export function toDriftVersion(tag: string): string | null {
  return semver.valid(tag) ? tag : null;
}

export function checkApplies(
  appliesFrom: string | null,
  version: string | null
): boolean {
  if (appliesFrom === null || version === null) return true;
  return semver.gte(version, appliesFrom);
}

export async function runDriftChecks(
  ctx: DriftContext,
  checks: readonly DriftCheck[]
): Promise<DriftReport> {
  const findings: DriftFinding[] = [];
  const skipped: DriftReport['skipped'] = [];

  for (const check of checks) {
    if (!checkApplies(check.appliesFrom, ctx.version)) continue;
    const outcome = await check.run(ctx);
    if (outcome === null) continue;
    if ('skipped' in outcome) {
      skipped.push({ checkId: check.id, reason: outcome.skipped });
      continue;
    }
    findings.push({
      ...outcome,
      checkId: check.id,
      severity: check.severity,
      appliesFrom: check.appliesFrom,
      notesVersion:
        outcome.notesVersion !== undefined
          ? outcome.notesVersion
          : check.appliesFrom,
    });
  }

  // Array.prototype.sort is stable, so registry order holds within a severity.
  findings.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  );

  return { version: ctx.version, findings, skipped };
}
