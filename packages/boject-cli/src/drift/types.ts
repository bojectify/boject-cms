export const DRIFT_SEVERITIES = {
  required: 'required',
  warning: 'warning',
  advice: 'advice',
} as const;

export type DriftSeverity =
  (typeof DRIFT_SEVERITIES)[keyof typeof DRIFT_SEVERITIES];

const DRIFT_SEVERITIES_SET: ReadonlySet<string> = new Set(
  Object.values(DRIFT_SEVERITIES)
);

export function isDriftSeverity(v: unknown): v is DriftSeverity {
  return typeof v === 'string' && DRIFT_SEVERITIES_SET.has(v);
}

export type EnvFileName = '.env' | '.env.local';

export interface DriftSnippet {
  /** '.env' | '.env.local' | '.gitignore' | 'docker-compose.yml' | 'terminal' */
  file: string;
  text: string;
}

export interface DriftIssue {
  title: string;
  detail: string[];
  snippets: DriftSnippet[];
  notesVersion?: string | null;
}

export type DriftCheckOutcome = DriftIssue | null | { skipped: string };

export interface DriftCheck {
  id: string;
  appliesFrom: string | null;
  severity: DriftSeverity;
  run(ctx: DriftContext): Promise<DriftCheckOutcome>;
}

export interface DriftFinding extends DriftIssue {
  checkId: string;
  severity: DriftSeverity;
  appliesFrom: string | null;
  notesVersion: string | null;
}

export interface DriftReport {
  version: string | null;
  findings: DriftFinding[];
  skipped: Array<{ checkId: string; reason: string }>;
}

export interface DriftContext {
  root: string;
  version: string | null;
  shellEnv: Readonly<Record<string, string | undefined>>;
  readEnvFile(name: EnvFileName): Promise<Record<string, string> | null>;
  isGitIgnored(path: string): Promise<boolean | null>;
  compose: Record<string, unknown> | null;
}
