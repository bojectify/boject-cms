import { describe, expect, it } from 'vitest';
import { buildFollowups } from './open-followups';

describe('buildFollowups', () => {
  it('produces 6 new issues + 1 comment on #25', () => {
    const result = buildFollowups({
      reportPath: 'perf/reports/2026-04-21-abc1234',
    });
    expect(result.newIssues).toHaveLength(6);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]!.issue).toBe(25);
  });

  it('new issues include report path in body', () => {
    const result = buildFollowups({
      reportPath: 'perf/reports/2026-04-21-abc1234',
    });
    expect(result.newIssues[0]!.body).toContain(
      'perf/reports/2026-04-21-abc1234'
    );
  });

  it('labels new issues with roadmap', () => {
    const result = buildFollowups({
      reportPath: 'perf/reports/2026-04-21-abc1234',
    });
    expect(result.newIssues[0]!.labels).toContain('roadmap');
  });
});
