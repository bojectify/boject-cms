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

  it('every issue and the comment carry the report path in their body', () => {
    const reportPath = 'perf/reports/2026-04-21-abc1234';
    const result = buildFollowups({ reportPath });
    for (const issue of result.newIssues) {
      expect(issue.body).toContain(`${reportPath}/summary.md`);
    }
    expect(result.comments[0]!.body).toContain(`${reportPath}/summary.md`);
  });

  it('every issue is labelled roadmap + enhancement', () => {
    const result = buildFollowups({
      reportPath: 'perf/reports/2026-04-21-abc1234',
    });
    for (const issue of result.newIssues) {
      expect(issue.labels).toEqual(['roadmap', 'enhancement']);
    }
  });

  it('normalises a trailing slash in reportPath so summary.md has no double slash', () => {
    const result = buildFollowups({
      reportPath: 'perf/reports/2026-04-21-abc1234/',
    });
    for (const issue of result.newIssues) {
      expect(issue.body).not.toMatch(/\/\/summary\.md/);
      expect(issue.body).toContain(
        'perf/reports/2026-04-21-abc1234/summary.md'
      );
    }
  });
});
