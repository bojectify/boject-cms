import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: spawnMock,
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  spawnMock.mockReset();
});

class FakeChild extends EventEmitter {
  stdout = new Readable({ read() {} });
  stderr = new Readable({ read() {} });
  stdin = new Writable({
    write(_c, _e, cb) {
      cb();
    },
  });
}

// Import after vi.mock so the mock is wired in.
const { runK6 } = await import('./runK6.js');

describe('runK6', () => {
  it('passes the configured env to k6 and returns paths on success', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'boject-runk6-'));

    const child = new FakeChild();
    spawnMock.mockImplementation(() => {
      // Defer the simulated child-process activity until after runK6 has
      // attached its listeners (it does so synchronously after spawn()
      // returns, but we still need to leave the current microtask).
      queueMicrotask(() => {
        child.stdout.push('progress 100% boject_secret\n');
        child.stdout.push(null);
        child.stderr.push(null);
        child.emit('close', 0);
      });
      return child as unknown as ChildProcess;
    });

    const stdoutLines: string[] = [];
    const promise = runK6({
      scenarioFile: '/tmp/fake-scenario.ts',
      env: {
        PERF_BASE_URL: 'https://x.example.com',
        PERF_API_KEY: 'boject_secret',
        PERF_LIST_FIELD: 'articleList',
      },
      apiKey: 'boject_secret',
      outDir: dir,
      stdout: (line) => stdoutLines.push(line),
      stderr: () => {},
    });

    const r = await promise;
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.exitCode).toBe(0);
    expect(r.rawJsonPath).toBe(join(dir, 'raw.json'));

    expect(spawnMock).toHaveBeenCalledWith(
      'k6',
      expect.arrayContaining([
        'run',
        '--out',
        `json=${join(dir, 'raw.json')}`,
        '/tmp/fake-scenario.ts',
      ]),
      expect.objectContaining({
        env: expect.objectContaining({
          PERF_BASE_URL: 'https://x.example.com',
          PERF_LIST_FIELD: 'articleList',
        }),
      })
    );

    expect(stdoutLines.join('\n')).toContain('[k6] progress 100% [REDACTED]');
  });

  it('returns the non-zero exit code from k6', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'boject-runk6-'));
    const child = new FakeChild();
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => {
        child.stdout.push(null);
        child.stderr.push(null);
        child.emit('close', 99);
      });
      return child as unknown as ChildProcess;
    });

    const promise = runK6({
      scenarioFile: '/tmp/x.ts',
      env: {},
      apiKey: '',
      outDir: dir,
      stdout: () => {},
      stderr: () => {},
    });

    const r = await promise;
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.exitCode).toBe(99);
  });

  it('flushes trailing partial line on close (no terminating newline)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'boject-runk6-'));
    const child = new FakeChild();
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => {
        child.stdout.push('progress 100%'); // no newline
        child.stdout.push(null);
        child.stderr.push(null);
        child.emit('close', 0);
      });
      return child as unknown as ChildProcess;
    });

    const stdoutLines: string[] = [];
    const promise = runK6({
      scenarioFile: '/tmp/x.ts',
      env: {},
      apiKey: '',
      outDir: dir,
      stdout: (l) => stdoutLines.push(l),
      stderr: () => {},
    });

    const r = await promise;
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.exitCode).toBe(0);
    expect(stdoutLines.join('\n')).toContain('[k6] progress 100%');
  });

  it('returns { ok: false } on child.error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'boject-runk6-'));
    const child = new FakeChild();
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => {
        child.emit('error', new Error('ENOENT: k6 not found'));
      });
      return child as unknown as ChildProcess;
    });

    const promise = runK6({
      scenarioFile: '/tmp/x.ts',
      env: {},
      apiKey: '',
      outDir: dir,
      stdout: () => {},
      stderr: () => {},
    });

    const r = await promise;
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/ENOENT/);
  });

  it('uses rawFilename for the --out json path when provided', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'boject-runk6-'));
    const child = new FakeChild();
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => {
        child.stdout.push(null);
        child.stderr.push(null);
        child.emit('close', 0);
      });
      return child as unknown as ChildProcess;
    });

    const promise = runK6({
      scenarioFile: '/tmp/x.ts',
      env: {},
      apiKey: '',
      outDir: dir,
      rawFilename: 'raw-bare.json',
      stdout: () => {},
      stderr: () => {},
    });

    const r = await promise;
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rawJsonPath).toBe(join(dir, 'raw-bare.json'));
    expect(spawnMock).toHaveBeenCalledWith(
      'k6',
      expect.arrayContaining([
        'run',
        '--out',
        `json=${join(dir, 'raw-bare.json')}`,
        '/tmp/x.ts',
      ]),
      expect.any(Object)
    );
  });

  it('does not redact when apiKey is empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'boject-runk6-'));
    const child = new FakeChild();
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => {
        child.stdout.push('boject_test_value\n');
        child.stdout.push(null);
        child.stderr.push(null);
        child.emit('close', 0);
      });
      return child as unknown as ChildProcess;
    });

    const stdoutLines: string[] = [];
    const promise = runK6({
      scenarioFile: '/tmp/x.ts',
      env: {},
      apiKey: '',
      outDir: dir,
      stdout: (l) => stdoutLines.push(l),
      stderr: () => {},
    });

    await promise;
    // With apiKey='' the line should NOT be redacted
    expect(stdoutLines.join('\n')).toContain('[k6] boject_test_value');
  });
});
