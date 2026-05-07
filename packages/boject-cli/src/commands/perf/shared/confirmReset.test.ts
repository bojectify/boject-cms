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
});
