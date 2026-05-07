import type { Readable } from 'node:stream';

export interface HeavyRunSummary {
  targetHost: string;
  peakRps: number;
  durationSeconds: number;
  scenarios: string[];
}

export interface ConfirmHeavyRunParams {
  summary: HeavyRunSummary;
  input: Readable;
  stdout: (line: string) => void;
  yes: boolean;
  isTty: boolean;
}

/**
 * TTY-interactive heavy-run confirmation prompt.
 *
 * Three modes (in priority order):
 *   1. `yes: true` — bypass entirely, no banner printed
 *   2. `isTty: false` && `yes: false` — return false (CI safety: never let unattended runs hit prod)
 *   3. TTY interactive — print banner, read one line from `input`, return true iff `y` / `yes`
 *
 * Default-N is enforced for empty input, EOF without newline, and any answer
 * other than literal `y` / `yes` (case-insensitive after trim).
 *
 * **Caller owns the stdin lifecycle.** This helper does not pause/resume
 * `process.stdin`, does not enable raw mode, and does not set encoding.
 * In production the caller should pass `process.stdin` and consider
 * pausing it after this resolves so subsequent k6 spawns don't steal
 * keystrokes from the user.
 */
export async function confirmHeavyRun(
  params: ConfirmHeavyRunParams
): Promise<boolean> {
  if (params.yes) return true;
  if (!params.isTty) {
    // Non-TTY (CI) without --yes is a deliberate hard refusal so
    // unattended runs can never hammer prod by mistake. The CLI
    // surface advertises this in its USAGE string.
    return false;
  }

  const { summary } = params;
  const banner = [
    '',
    '─── HEAVY LOAD CONFIRMATION ───',
    `  Target:    ${summary.targetHost}`,
    `  Peak RPS:  ${summary.peakRps}`,
    `  Duration:  ${summary.durationSeconds}s`,
    `  Scenarios: ${summary.scenarios.join(', ')}`,
    '',
    'Target should be a perf-clone, not production.',
    'Continue? [y/N]',
    '',
  ];
  for (const line of banner) params.stdout(line);

  return new Promise<boolean>((resolveResult) => {
    let buffered = '';
    const onData = (chunk: Buffer | string): void => {
      buffered += String(chunk);
      const newlineIdx = buffered.indexOf('\n');
      if (newlineIdx === -1) return;
      const answer = buffered.slice(0, newlineIdx).trim().toLowerCase();
      params.input.off('data', onData);
      params.input.off('end', onEnd);
      resolveResult(answer === 'y' || answer === 'yes');
    };
    const onEnd = (): void => {
      // Stream closed without a newline — treat as "N".
      params.input.off('data', onData);
      params.input.off('end', onEnd);
      resolveResult(false);
    };
    params.input.on('data', onData);
    params.input.on('end', onEnd);
  });
}
