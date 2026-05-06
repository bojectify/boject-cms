import { spawn } from 'node:child_process';
import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { sanitiseLogLine } from './sanitise.js';

export interface RunK6Params {
  scenarioFile: string;
  env: Record<string, string>;
  apiKey: string;
  outDir: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface RunK6Result {
  exitCode: number;
  rawJsonPath: string;
  stderrLogPath: string;
}

export async function runK6(params: RunK6Params): Promise<RunK6Result> {
  await mkdir(params.outDir, { recursive: true });
  const rawJsonPath = join(params.outDir, 'raw.json');
  const stderrLogPath = join(params.outDir, 'k6-stderr.log');
  const stderrFile = await open(stderrLogPath, 'w');

  return new Promise<RunK6Result>((resolveResult, reject) => {
    const child = spawn(
      'k6',
      ['run', '--out', `json=${rawJsonPath}`, params.scenarioFile],
      {
        env: { ...process.env, ...params.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    const decoder = new TextDecoder();
    let stdoutBuffer = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuffer += decoder.decode(chunk);
      let idx;
      while ((idx = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.slice(0, idx);
        stdoutBuffer = stdoutBuffer.slice(idx + 1);
        params.stdout(`[k6] ${sanitiseLogLine(line, params.apiKey)}`);
      }
    });

    let stderrBuffer = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuffer += decoder.decode(chunk);
      stderrFile.write(chunk);
      let idx;
      while ((idx = stderrBuffer.indexOf('\n')) !== -1) {
        const line = stderrBuffer.slice(0, idx);
        stderrBuffer = stderrBuffer.slice(idx + 1);
        params.stderr(`[k6] ${sanitiseLogLine(line, params.apiKey)}`);
      }
    });

    child.on('error', (err) => {
      stderrFile.close().finally(() => reject(err));
    });
    child.on('close', (code) => {
      stderrFile.close().finally(() =>
        resolveResult({
          exitCode: typeof code === 'number' ? code : 1,
          rawJsonPath,
          stderrLogPath,
        })
      );
    });
  });
}
