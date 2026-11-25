import { describe, expect, it } from 'vitest';
import { renderDriftReport } from '../../../src/drift/render.js';
import type { DriftFinding, DriftReport } from '../../../src/drift/types.js';

const finding = (over: Partial<DriftFinding> = {}): DriftFinding => ({
  checkId: 'search-and-cache-services',
  severity: 'required',
  appliesFrom: '0.0.1-rc.2',
  notesVersion: '0.0.1-rc.2',
  title: 'This version needs Meilisearch and Redis',
  detail: ['Not set in .env: REDIS_URL'],
  snippets: [{ file: '.env', text: 'REDIS_URL=redis://redis:6379' }],
  ...over,
});

const report = (over: Partial<DriftReport> = {}): DriftReport => ({
  version: '0.0.3',
  findings: [],
  skipped: [],
  ...over,
});

describe('renderDriftReport', () => {
  it('empty report renders nothing', () => {
    expect(renderDriftReport(report())).toEqual([]);
  });

  it('required finding renders header, detail, snippet and notes link', () => {
    expect(renderDriftReport(report({ findings: [finding()] }))).toEqual([
      '✗ required  search-and-cache-services — This version needs Meilisearch and Redis',
      '    Not set in .env: REDIS_URL',
      '    Add to .env:',
      '      REDIS_URL=redis://redis:6379',
      '    Upgrade notes: https://github.com/bojectify/boject-cms/releases/tag/v0.0.1-rc.2',
    ]);
  });

  it('uses the warning and advice headers', () => {
    const lines = renderDriftReport(
      report({
        findings: [
          finding({ severity: 'warning', checkId: 'w', title: 'T' }),
          finding({ severity: 'advice', checkId: 'a', title: 'T' }),
        ],
      })
    );
    expect(lines).toContain('! warning   w — T');
    expect(lines).toContain('· advice    a — T');
    expect(lines).toContain('');
  });

  it('terminal snippet renders as "Run:"', () => {
    const lines = renderDriftReport(
      report({
        findings: [
          finding({ snippets: [{ file: 'terminal', text: 'boject apikey' }] }),
        ],
      })
    );
    expect(lines).toContain('    Run:');
    expect(lines).toContain('      boject apikey');
  });

  it('null notesVersion has no link', () => {
    const lines = renderDriftReport(
      report({ findings: [finding({ notesVersion: null })] })
    );
    expect(lines.some((l) => l.includes('Upgrade notes'))).toBe(false);
  });

  it('skipped renders one dim line each', () => {
    expect(
      renderDriftReport(
        report({
          skipped: [
            { checkId: 'a', reason: 'no .env' },
            { checkId: 'b', reason: 'no git' },
          ],
        })
      )
    ).toEqual(['  (skipped a: no .env)', '  (skipped b: no git)']);
  });
});
