import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { sanitiseLogLine } from './sanitise.js';

export interface RunK6Params {
  scenarioFile: string;
  env: Record<string, string>;
  apiKey: string;
  outDir: string;
  /**
   * Filename for the k6 NDJSON output, written under `outDir`. Defaults to
   * `'raw.json'`. Override when invoking k6 multiple times against the same
   * `outDir` (e.g. one call per query shape) so each invocation writes to a
   * distinct file instead of overwriting the previous run.
   */
  rawFilename?: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export type RunK6Result =
  | { ok: true; exitCode: number; rawJsonPath: string; stderrLogPath: string }
  | { ok: false; error: string };

export async function runK6(params: RunK6Params): Promise<RunK6Result> {
  await mkdir(params.outDir, { recursive: true });
  const rawJsonPath = join(params.outDir, params.rawFilename ?? 'raw.json');
  const stderrLogPath = join(params.outDir, 'k6-stderr.log');
  // Note: the stderr log file is line-oriented UTF-8 (sanitised text), not a
  // byte-for-byte mirror of the child stderr stream. Sanitisation is applied
  // before the write so that any API key accidentally echoed by k6 (e.g. via
  // --http-debug or scenario console.log) cannot leak to disk.
  const stderrFile = await open(stderrLogPath, 'w');

  return new Promise<RunK6Result>((resolveResult) => {
    let child: ChildProcess;
    try {
      child = spawn(
        'k6',
        ['run', '--out', `json=${rawJsonPath}`, params.scenarioFile],
        {
          env: { ...process.env, ...params.env },
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
    } catch (err) {
      stderrFile.close().finally(() =>
        resolveResult({
          ok: false,
          error: `Failed to spawn k6: ${(err as Error).message}`,
        })
      );
      return;
    }

    // Use TWO TextDecoder instances — each holds per-stream multibyte state
    // across chunks (with { stream: true }), so they cannot be shared.
    const stdoutDecoder = new TextDecoder();
    const stderrDecoder = new TextDecoder();

    let stdoutBuffer = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuffer += stdoutDecoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.slice(0, idx);
        stdoutBuffer = stdoutBuffer.slice(idx + 1);
        params.stdout(`[k6] ${sanitiseLogLine(line, params.apiKey)}`);
      }
    });

    let stderrBuffer = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = stderrDecoder.decode(chunk, { stream: true });
      const sanitised = sanitiseLogLine(text, params.apiKey);
      // Best-effort log file. If disk fills, the run continues — caller still
      // gets exitCode via the close handler. Don't crash the perf run on
      // log-write failure.
      void stderrFile.write(sanitised).catch(() => {});
      stderrBuffer += sanitised;
      let idx;
      while ((idx = stderrBuffer.indexOf('\n')) !== -1) {
        const line = stderrBuffer.slice(0, idx);
        stderrBuffer = stderrBuffer.slice(idx + 1);
        params.stderr(`[k6] ${sanitiseLogLine(line, params.apiKey)}`);
      }
    });

    // Track which streams have ended so we only finalise once everything
    // has drained. The child's `close` event can fire before the stdout
    // 'data' events are dispatched (Node delivers data via process.nextTick
    // while emit() is synchronous), so flushing partial buffers in `close`
    // would race the data handler. We instead flush each stream in its own
    // `end` handler (guaranteed to fire after every `data` event) and only
    // resolve the promise once both streams have ended AND `close` has
    // fired with the exit code.
    let stdoutEnded = false;
    let stderrEnded = false;
    let exitCode: number | null = null;
    let exitClosed = false;
    let resolved = false;

    const finalise = () => {
      if (resolved) return;
      if (!stdoutEnded || !stderrEnded || !exitClosed) return;
      resolved = true;
      stderrFile.close().finally(() =>
        resolveResult({
          ok: true,
          exitCode: typeof exitCode === 'number' ? exitCode : 1,
          rawJsonPath,
          stderrLogPath,
        })
      );
    };

    child.stdout?.on('end', () => {
      // Flush any trailing bytes the decoder is still holding (e.g. a
      // multibyte sequence split across chunks) plus any buffered line
      // that lacks a terminating newline.
      stdoutBuffer += stdoutDecoder.decode();
      if (stdoutBuffer.length > 0) {
        params.stdout(`[k6] ${sanitiseLogLine(stdoutBuffer, params.apiKey)}`);
        stdoutBuffer = '';
      }
      stdoutEnded = true;
      finalise();
    });

    child.stderr?.on('end', () => {
      const stderrTail = stderrDecoder.decode();
      if (stderrTail.length > 0) {
        const sanitisedTail = sanitiseLogLine(stderrTail, params.apiKey);
        void stderrFile.write(sanitisedTail).catch(() => {});
        stderrBuffer += sanitisedTail;
      }
      if (stderrBuffer.length > 0) {
        params.stderr(`[k6] ${sanitiseLogLine(stderrBuffer, params.apiKey)}`);
        stderrBuffer = '';
      }
      stderrEnded = true;
      finalise();
    });

    child.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      stderrFile.close().finally(() =>
        resolveResult({
          ok: false,
          error: `k6 process error: ${err.message}`,
        })
      );
    });
    child.on('close', (code) => {
      exitCode = typeof code === 'number' ? code : 1;
      exitClosed = true;
      finalise();
    });
  });
}
