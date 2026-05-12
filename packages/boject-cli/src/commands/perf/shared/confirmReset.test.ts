import { describe, expect, it } from 'vitest';
import { confirmReset } from './confirmReset.js';

describe('confirmReset', () => {
  it('returns true when --yes is passed', async () => {
    const r = await confirmReset({
      databaseUrl: 'postgresql://u:p@h/boject_perf',
      yes: true,
      readLine: async () => 'n',
    });
    expect(r).toBe(true);
  });

  it('returns true when stdin is not a TTY (CI mode)', async () => {
    const r = await confirmReset({
      databaseUrl: 'postgresql://u:p@h/boject_perf',
      yes: false,
      readLine: async () => '',
      isTty: false,
    });
    expect(r).toBe(true);
  });

  it('returns true on yes-prompt response', async () => {
    const r = await confirmReset({
      databaseUrl: 'postgresql://u:p@h/boject_perf',
      yes: false,
      readLine: async () => 'yes',
      isTty: true,
    });
    expect(r).toBe(true);
  });

  it('returns false on any other prompt response', async () => {
    const r = await confirmReset({
      databaseUrl: 'postgresql://u:p@h/boject_perf',
      yes: false,
      readLine: async () => 'no',
      isTty: true,
    });
    expect(r).toBe(false);
  });

  it('prompt copy makes clear ALL entries are truncated, not just perf-seeded rows', async () => {
    const originalWrite = process.stderr.write.bind(process.stderr);
    const writes: string[] = [];
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    }) as typeof process.stderr.write;
    try {
      await confirmReset({
        databaseUrl: 'postgresql://u:p@h/boject_perf',
        yes: false,
        readLine: async () => 'no',
        isTty: true,
      });
    } finally {
      process.stderr.write = originalWrite;
    }
    const prompt = writes.join('');
    expect(prompt).toContain('TRUNCATE');
    expect(prompt).toContain('ALL content entries');
    expect(prompt).toContain('not just perf-seeded rows');
    expect(prompt).not.toContain('perf data');
  });
});
