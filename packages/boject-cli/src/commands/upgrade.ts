import { join } from 'node:path';
import { readComposeImage, writeComposeImage } from '../compose.js';
import { pollHealth } from '../health.js';
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
}

export interface UpgradeParams {
  cwd: string;
  runner: CommandRunner;
  flags?: UpgradeFlags;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface UpgradeResult {
  exitCode: 0 | 1;
  message: string;
}

const HEALTH_URL = 'http://localhost:4000/api/health';
const HEALTH_TIMEOUT_MS = 120_000;
const HEALTH_INTERVAL_MS = 2_000;

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

  if (flags.dryRun) {
    return {
      exitCode: 0,
      message: [
        '--- docker-compose.yml (dry run)',
        `- image: ${repository}:${currentTag}`,
        `+ image: ${repository}:${targetTag}`,
      ].join('\n'),
    };
  }

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

  await pollHealth(HEALTH_URL, {
    timeoutMs: HEALTH_TIMEOUT_MS,
    intervalMs: HEALTH_INTERVAL_MS,
  });
  return { exitCode: 0, message: `Upgraded ${currentTag} → ${targetTag}.` };
}
