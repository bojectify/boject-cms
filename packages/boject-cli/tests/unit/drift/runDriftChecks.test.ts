import { describe, expect, it, vi } from 'vitest';
import {
  checkApplies,
  runDriftChecks,
  toDriftVersion,
} from '../../../src/drift/runDriftChecks.js';
import type {
  DriftCheck,
  DriftCheckOutcome,
  DriftContext,
  DriftSeverity,
} from '../../../src/drift/types.js';

const makeCtx = (version: string | null): DriftContext => ({
  root: '/tmp/x',
  version,
  shellEnv: {},
  readEnvFile: async () => null,
  isGitIgnored: async () => null,
  compose: null,
});

const issue = { title: 't', detail: [], snippets: [] };

const stub = (
  id: string,
  severity: DriftSeverity,
  appliesFrom: string | null,
  outcome: DriftCheckOutcome = { ...issue, title: id }
): DriftCheck => ({
  id,
  severity,
  appliesFrom,
  run: vi.fn(async () => outcome),
});

describe('checkApplies', () => {
  it('gates on prereleases', () => {
    expect(checkApplies('0.0.1-rc.2', '0.0.1-rc.1')).toBe(false);
    expect(checkApplies('0.0.1-rc.2', '0.0.1-rc.2')).toBe(true);
    expect(checkApplies('0.0.1-rc.2', '0.0.3')).toBe(true);
    expect(checkApplies(null, '0.0.1')).toBe(true);
    expect(checkApplies('0.0.3', null)).toBe(true);
  });
});

describe('toDriftVersion', () => {
  it('returns valid semver tags and null otherwise', () => {
    expect(toDriftVersion('0.0.3')).toBe('0.0.3');
    expect(toDriftVersion('latest')).toBeNull();
  });
});

describe('runDriftChecks', () => {
  it('skips checks whose appliesFrom is newer than ctx.version', async () => {
    const c = stub('a', 'warning', '0.0.3');
    const report = await runDriftChecks(makeCtx('0.0.2'), [c]);
    expect(c.run).not.toHaveBeenCalled();
    expect(report.findings).toEqual([]);
    expect(report.version).toBe('0.0.2');
  });

  it('runs every check when ctx.version is null', async () => {
    const a = stub('a', 'warning', '0.0.3');
    const b = stub('b', 'advice', '0.0.2');
    const report = await runDriftChecks(makeCtx(null), [a, b]);
    expect(a.run).toHaveBeenCalled();
    expect(b.run).toHaveBeenCalled();
    expect(report.findings).toHaveLength(2);
  });

  it('orders findings required → warning → advice, registry order within a severity', async () => {
    const report = await runDriftChecks(makeCtx(null), [
      stub('adv', 'advice', null),
      stub('w1', 'warning', null),
      stub('req', 'required', null),
      stub('w2', 'warning', null),
    ]);
    expect(report.findings.map((f) => f.checkId)).toEqual([
      'req',
      'w1',
      'w2',
      'adv',
    ]);
  });

  it('notesVersion defaults to appliesFrom; an explicit null is kept', async () => {
    const report = await runDriftChecks(makeCtx(null), [
      stub('def', 'warning', '0.0.2'),
      stub('nul', 'warning', '0.0.2', { ...issue, notesVersion: null }),
      stub('exp', 'warning', '0.0.2', { ...issue, notesVersion: '0.0.9' }),
    ]);
    const by = Object.fromEntries(
      report.findings.map((f) => [f.checkId, f.notesVersion])
    );
    expect(by).toEqual({ def: '0.0.2', nul: null, exp: '0.0.9' });
    expect(report.findings[0]).toMatchObject({
      checkId: 'def',
      severity: 'warning',
      appliesFrom: '0.0.2',
    });
  });

  it('collects skipped outcomes with checkId + reason', async () => {
    const report = await runDriftChecks(makeCtx(null), [
      stub('s', 'warning', null, { skipped: 'no compose' }),
      stub('ok', 'warning', null, null),
    ]);
    expect(report.skipped).toEqual([{ checkId: 's', reason: 'no compose' }]);
    expect(report.findings).toEqual([]);
  });
});
