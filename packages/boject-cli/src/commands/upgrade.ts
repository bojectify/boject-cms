import { join } from 'node:path';
import semver from 'semver';
import { readComposeImage, writeComposeImage } from '../compose.js';
import { loadProjectConfig } from '../config.js';
import { pollHealth } from '../health.js';
import { createDriftContext } from '../drift/context.js';
import { DRIFT_CHECKS } from '../drift/checks/index.js';
import { renderDriftReport } from '../drift/render.js';
import { runDriftChecks, toDriftVersion } from '../drift/runDriftChecks.js';
import { DRIFT_SEVERITIES, type DriftFinding } from '../drift/types.js';
import { listTags, parseImageRef, pickHighestSemver } from '../registry.js';

export interface CommandRunner {
  run(
    cmd: string,
    args: string[],
    opts?: { cwd?: string }
  ): Promise<{ status: number | null }>;
}

export interface UpgradeFlags {
  to?: string;
  dryRun?: boolean;
  check?: boolean;
  /** CMS base URL for the post-upgrade health check (overrides cms.url). */
  url?: string;
  /** Upgrade even when required drift changes are outstanding. */
  force?: boolean;
}

export interface UpgradeParams {
  cwd: string;
  runner: CommandRunner;
  flags?: UpgradeFlags;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  /** Shell env captured before `.env` loading (drift checks read it). */
  shellEnv?: Readonly<Record<string, string | undefined>>;
  isGitIgnored?: (path: string, root: string) => Promise<boolean | null>;
}

export interface UpgradeResult {
  exitCode: 0 | 1;
  message: string;
}

const DEFAULT_CMS_URL = 'http://localhost:4000';
const HEALTH_TIMEOUT_MS = 120_000;
const HEALTH_INTERVAL_MS = 2_000;

/**
 * True when upgrading from `currentTag` crosses the version a check applies
 * from, i.e. the project is moving onto an image that needs the change. A
 * non-semver current tag (e.g. `latest`) is treated as crossing.
 */
export function crossesInto(
  appliesFrom: string | null,
  currentTag: string
): boolean {
  return (
    appliesFrom !== null &&
    (toDriftVersion(currentTag) === null || semver.lt(currentTag, appliesFrom))
  );
}

const SEVERITY_RANK = {
  [DRIFT_SEVERITIES.required]: 0,
  [DRIFT_SEVERITIES.warning]: 1,
  [DRIFT_SEVERITIES.advice]: 2,
};

const NO_CONFIG_PREFIX = 'No .boject.config.json found';

/**
 * The CMS base URL to health-check after the restart (#503): `--url`, else
 * `cms.url` from `.boject.config.json`, else the scaffold default. A missing
 * config falls back silently (upgrade only needs docker-compose.yml); an
 * unreadable/invalid one falls back with a warning rather than blocking the
 * upgrade.
 */
async function resolveCmsUrl(
  cwd: string,
  flagUrl: string | undefined,
  stderr: (line: string) => void
): Promise<string> {
  if (flagUrl) return flagUrl;
  try {
    const { config } = await loadProjectConfig(cwd);
    return config.cms.url;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.startsWith(NO_CONFIG_PREFIX)) {
      stderr(
        `Warning: could not read cms.url from .boject.config.json (${message}); health-checking ${DEFAULT_CMS_URL} instead.`
      );
    }
    return DEFAULT_CMS_URL;
  }
}

export async function runUpgrade(
  params: UpgradeParams
): Promise<UpgradeResult> {
  const flags = params.flags ?? {};
  const composePath = join(params.cwd, 'docker-compose.yml');

  const currentRef = await readComposeImage(composePath);
  const { registry, repository, tag: currentTag } = parseImageRef(currentRef);

  let targetTag: string;
  if (flags.to) {
    targetTag = flags.to;
  } else {
    const tags = await listTags({ registry, repository });
    const highest = pickHighestSemver(tags);
    if (!highest) {
      return {
        exitCode: 1,
        message: `No semver tags found at ${registry}/${repository}.`,
      };
    }
    targetTag = highest;
  }

  if (currentTag === targetTag) {
    if (flags.check) {
      return { exitCode: 0, message: `Up to date: ${currentTag}` };
    }
    return { exitCode: 0, message: `Already on ${currentTag}` };
  }

  if (flags.check) {
    return {
      exitCode: 1,
      message: `Update available: ${currentTag} → ${targetTag}`,
    };
  }

  // Drift pre-flight: required findings only block when this upgrade crosses
  // the version they apply from; otherwise they are already-present drift.
  const ctx = await createDriftContext({
    root: params.cwd,
    version: toDriftVersion(targetTag),
    shellEnv: params.shellEnv ?? {},
    isGitIgnored: params.isGitIgnored,
  });
  const report = await runDriftChecks(ctx, DRIFT_CHECKS);
  const findings: DriftFinding[] = report.findings
    .map((f) =>
      f.severity === DRIFT_SEVERITIES.required &&
      !crossesInto(f.appliesFrom, currentTag)
        ? { ...f, severity: DRIFT_SEVERITIES.warning }
        : f
    )
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  for (const line of renderDriftReport({ ...report, findings })) {
    params.stdout(line);
  }
  const blocking = findings.filter(
    (f) => f.severity === DRIFT_SEVERITIES.required
  );
  const blocked = blocking.length > 0 && !flags.force;

  if (blocked && !flags.dryRun) {
    return {
      exitCode: 1,
      message: `Upgrade to ${targetTag} not applied: ${blocking.length} required change(s) above. Make them and re-run, or pass --force to upgrade anyway.`,
    };
  }

  if (flags.dryRun) {
    return {
      exitCode: blocked ? 1 : 0,
      message: [
        '--- docker-compose.yml (dry run)',
        `- image: ${repository}:${currentTag}`,
        `+ image: ${repository}:${targetTag}`,
      ].join('\n'),
    };
  }

  const cmsUrl = await resolveCmsUrl(params.cwd, flags.url, params.stderr);
  const healthUrl = `${cmsUrl.replace(/\/+$/, '')}/api/health`;

  const newRef = `${registry}/${repository}:${targetTag}`;
  await writeComposeImage(composePath, newRef);

  const pull = await params.runner.run('docker', ['compose', 'pull', 'cms'], {
    cwd: params.cwd,
  });
  if (pull.status !== 0) {
    return {
      exitCode: 1,
      message: `docker compose pull cms failed (exit ${pull.status}).`,
    };
  }
  const up = await params.runner.run('docker', ['compose', 'up', '-d'], {
    cwd: params.cwd,
  });
  if (up.status !== 0) {
    return {
      exitCode: 1,
      message: `docker compose up -d failed (exit ${up.status}).`,
    };
  }

  try {
    await pollHealth(healthUrl, {
      timeoutMs: HEALTH_TIMEOUT_MS,
      intervalMs: HEALTH_INTERVAL_MS,
    });
  } catch (err) {
    // The image swap itself succeeded — say so, rather than reading as a
    // failed upgrade (#503).
    return {
      exitCode: 1,
      message: [
        `Upgraded ${currentTag} → ${targetTag} and restarted the stack, but the health check did not pass.`,
        err instanceof Error ? err.message : String(err),
        `The CMS may still be starting, or be served on a different URL (set cms.url in .boject.config.json or pass --url).`,
        `Check: docker compose logs cms`,
      ].join('\n'),
    };
  }
  return { exitCode: 0, message: `Upgraded ${currentTag} → ${targetTag}.` };
}
