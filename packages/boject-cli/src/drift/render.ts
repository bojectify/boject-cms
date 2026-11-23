import { releaseNotesUrl } from './scaffoldSnippets.js';
import type { DriftFinding, DriftReport } from './types.js';

const SEVERITY_LABELS: Record<DriftFinding['severity'], string> = {
  required: '✗ required ',
  warning: '! warning  ',
  advice: '· advice   ',
};

function renderFinding(finding: DriftFinding): string[] {
  const lines = [
    `${SEVERITY_LABELS[finding.severity]} ${finding.checkId} — ${finding.title}`,
  ];
  for (const line of finding.detail) lines.push(`    ${line}`);
  for (const snippet of finding.snippets) {
    lines.push(
      snippet.file === 'terminal' ? '    Run:' : `    Add to ${snippet.file}:`
    );
    for (const line of snippet.text.split('\n')) lines.push(`      ${line}`);
  }
  if (finding.notesVersion !== null) {
    lines.push(`    Upgrade notes: ${releaseNotesUrl(finding.notesVersion)}`);
  }
  return lines;
}

/** Shared by `boject doctor` and `boject upgrade`. Empty report -> []. */
export function renderDriftReport(report: DriftReport): string[] {
  const lines: string[] = [];
  report.findings.forEach((finding, i) => {
    if (i > 0) lines.push('');
    lines.push(...renderFinding(finding));
  });
  if (report.findings.length > 0 && report.skipped.length > 0) lines.push('');
  for (const s of report.skipped) {
    lines.push(`  (skipped ${s.checkId}: ${s.reason})`);
  }
  return lines;
}
