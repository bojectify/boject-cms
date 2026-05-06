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
      resolveResult(false);
    };
    params.input.on('data', onData);
    params.input.on('end', onEnd);
  });
}
