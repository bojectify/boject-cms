import { spawnSync } from 'node:child_process';
import { posix } from 'node:path';

export interface FollowupIssue {
  title: string;
  body: string;
  labels: string[];
}

export interface Comment {
  issue: number;
  body: string;
}

export interface BuildResult {
  newIssues: FollowupIssue[];
  comments: Comment[];
}

export function buildFollowups(opts: { reportPath: string }): BuildResult {
  // posix.join collapses any trailing slash in `reportPath` so the rendered
  // body is always `…runId/summary.md`, never `…runId//summary.md`.
  const summary = posix.join(opts.reportPath, 'summary.md');
  const ref = `\n\nReport: \`${summary}\``;
  const newIssues: FollowupIssue[] = [
    {
      title: 'Rate limiting on /api/graphql',
      body:
        'Apply a per-API-key rate limit on `/api/graphql`. Threshold derived from scenario 1B soft breakpoint in the load-test report. Reuse `apps/cms/server/utils/rateLimitEndpoint.ts`.' +
        ref,
      labels: ['roadmap', 'enhancement'],
    },
    {
      title: 'GraphQL query complexity scoring',
      body:
        'Add Contentful-style query complexity scoring. Set max cost from scenario 1B "relation" vs "bare" delta. Pothos community plugin available.' +
        ref,
      labels: ['roadmap', 'enhancement'],
    },
    {
      title: 'Rate-limit + cost headers on GraphQL responses',
      body:
        'Surface `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-Query-Cost` on every `/api/graphql` response. Also expose via GraphQL `extensions`.' +
        ref,
      labels: ['roadmap', 'enhancement'],
    },
    {
      title: 'Richer 429 error shape (REST + GraphQL)',
      body:
        'Replace `{ error: "Too many requests" }` with `{ error, retryAfter, suggestion }`. Consumer-guidance strings come from the load-test recommendations.' +
        ref,
      labels: ['roadmap', 'enhancement'],
    },
    {
      title: 'Phase 2: wire perf suite into GHA with thresholds',
      body:
        'Turn the load-test suite into a CI regression guard. Use the committed report as the baseline and fail runs on significant regressions.' +
        ref,
      labels: ['roadmap', 'enhancement'],
    },
    {
      title: 'Portable perf scenarios via boject perf CLI',
      body:
        'Expose the load-test scenarios as a command on `@boject/cli` so `create-boject-cms` users can benchmark their own instances against their own content types.' +
        ref,
      labels: ['roadmap', 'enhancement'],
    },
  ];

  const comments: Comment[] = [
    {
      issue: 25,
      body:
        'Observed evidence from the first load-test report. Filtered query performance on PerfArticle (30K rows) vs bare query — see scenario 1B "filtered" vs "bare" shape comparison.' +
        ref,
    },
  ];

  return { newIssues, comments };
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const reportPath = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!reportPath) {
    console.error('Usage: open-followups <reportPath> [--dry-run]');
    process.exit(1);
  }
  const { newIssues, comments } = buildFollowups({ reportPath });

  for (const issue of newIssues) {
    const args = [
      'issue',
      'create',
      '--title',
      issue.title,
      '--body',
      issue.body,
      '--label',
      issue.labels.join(','),
    ];
    if (dryRun) {
      console.log('[dry-run] gh', args.map((a) => JSON.stringify(a)).join(' '));
    } else {
      const result = spawnSync('gh', args, { stdio: 'inherit' });
      if (result.status !== 0) {
        console.error(`gh issue create failed for: ${issue.title}`);
        process.exit(1);
      }
    }
  }

  for (const c of comments) {
    const args = ['issue', 'comment', String(c.issue), '--body', c.body];
    if (dryRun) {
      console.log('[dry-run] gh', args.map((a) => JSON.stringify(a)).join(' '));
    } else {
      const result = spawnSync('gh', args, { stdio: 'inherit' });
      if (result.status !== 0) {
        console.error(`gh issue comment failed on #${c.issue}`);
        process.exit(1);
      }
    }
  }
}
