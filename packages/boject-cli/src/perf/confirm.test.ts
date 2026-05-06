import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { confirmHeavyRun } from './confirm.js';

function inputStream(text: string): Readable {
  return Readable.from([text]);
}

describe('confirmHeavyRun', () => {
  const summary = {
    targetHost: 'cms-staging.example.com',
    peakRps: 2000,
    durationSeconds: 180,
    scenarios: ['graphql-flat', 'graphql-sitemap'],
  };

  it('returns true when input is "y"', async () => {
    const out: string[] = [];
    const r = await confirmHeavyRun({
      summary,
      input: inputStream('y\n'),
      stdout: (l) => out.push(l),
      yes: false,
      isTty: true,
    });
    expect(r).toBe(true);
    expect(out.join('\n')).toContain('cms-staging.example.com');
    expect(out.join('\n')).toContain('2000');
  });

  it('returns true when input is "yes"', async () => {
    const r = await confirmHeavyRun({
      summary,
      input: inputStream('yes\n'),
      stdout: () => {},
      yes: false,
      isTty: true,
    });
    expect(r).toBe(true);
  });

  it('returns false on empty input (default N)', async () => {
    const r = await confirmHeavyRun({
      summary,
      input: inputStream('\n'),
      stdout: () => {},
      yes: false,
      isTty: true,
    });
    expect(r).toBe(false);
  });

  it('returns false on any non-y answer', async () => {
    const r = await confirmHeavyRun({
      summary,
      input: inputStream('n\n'),
      stdout: () => {},
      yes: false,
      isTty: true,
    });
    expect(r).toBe(false);
  });

  it('returns true without prompting when yes=true', async () => {
    const out: string[] = [];
    const r = await confirmHeavyRun({
      summary,
      input: inputStream('this should not be read'),
      stdout: (l) => out.push(l),
      yes: true,
      isTty: true,
    });
    expect(r).toBe(true);
    expect(out.length).toBe(0);
  });

  it('returns false in non-TTY mode without --yes (CI safety)', async () => {
    const r = await confirmHeavyRun({
      summary,
      input: inputStream(''),
      stdout: () => {},
      yes: false,
      isTty: false,
    });
    expect(r).toBe(false);
  });

  it('handles answers split across multiple chunks', async () => {
    const r = await confirmHeavyRun({
      summary,
      input: Readable.from(['y', '\n']),
      stdout: () => {},
      yes: false,
      isTty: true,
    });
    expect(r).toBe(true);
  });

  it('returns false when stream ends without a newline (Ctrl-D, default N)', async () => {
    const r = await confirmHeavyRun({
      summary,
      input: Readable.from(['y']), // no trailing newline; stream ends immediately after
      stdout: () => {},
      yes: false,
      isTty: true,
    });
    expect(r).toBe(false);
  });
});
