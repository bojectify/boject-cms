import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { renderReport, type RunMetadata } from '../../perf/render.js';
import type { RunMode } from '../../perf/runMode.js';
import { loadProjectConfig } from '../../config.js';

const RUN_MODES = ['seed-direct', 'read-only'] as const;
type RunModeStr = (typeof RUN_MODES)[number];

const PARTIAL_SOURCES = ['reset', 'seed', 'k6'] as const;
type PartialSource = (typeof PARTIAL_SOURCES)[number];

export interface PerfReportFlags {
  from?: string;
  out?: string;
  // #122 — operator's current BOJECT_GRAPHQL_COMPLEXITY_MAX_COST.
  currentMaxCost?: number;
}

export interface PerfReportParams {
  cwd: string;
  flags: PerfReportFlags;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface PerfReportResult {
  exitCode: 0 | 2;
}

async function findLatest(rootDir: string): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  if (dirs.length === 0) return null;
  dirs.sort(); // ISO timestamps + suffix sort lexicographically.
  return join(rootDir, dirs[dirs.length - 1]!);
}

export async function runPerfReport(
  params: PerfReportParams
): Promise<PerfReportResult> {
  const flags = params.flags;
  let runDir: string | null = null;

  if (flags.from) {
    runDir = resolve(params.cwd, flags.from);
    try {
      await stat(runDir);
    } catch {
      params.stderr(`Error: --from "${flags.from}" — no such directory.`);
      return { exitCode: 2 };
    }
  } else {
    let outRoot = flags.out;
    if (!outRoot) {
      try {
        const c = await loadProjectConfig(params.cwd);
        outRoot = c.config.perf?.out;
      } catch (err) {
        const m = (err as Error).message;
        if (!m.startsWith('No .boject.config.json found')) {
          params.stderr(`Warning: ignoring config: ${m}`);
        }
      }
    }
    outRoot = resolve(params.cwd, outRoot ?? './perf-reports');
    runDir = await findLatest(outRoot);
    if (!runDir) {
      params.stderr(
        `Error: no runs found in ${outRoot}. Run \`boject perf scenario\` or \`boject perf sweep\` first, or pass --from <dir>.`
      );
      return { exitCode: 2 };
    }
  }

  const rawJsonPath = join(runDir, 'raw.json');
  const metadataPath = join(runDir, 'metadata.json');

  try {
    await stat(rawJsonPath);
  } catch {
    params.stderr(`Error: ${rawJsonPath} not found in ${runDir}.`);
    return { exitCode: 2 };
  }

  let metadata: RunMetadata;
  try {
    const raw = await readFile(metadataPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    metadata = {
      perfCalibratedAt: String(parsed.perfCalibratedAt ?? ''),
      cliVersion: String(parsed.cliVersion ?? 'unknown'),
      k6Version: String(parsed.k6Version ?? 'unknown'),
      targetHost: String(
        (parsed.target as { host?: string } | undefined)?.host ?? 'unknown'
      ),
      targetScheme:
        (parsed.target as { scheme?: 'http' | 'https' } | undefined)?.scheme ===
        'http'
          ? 'http'
          : 'https',
      contentType: String(parsed.contentType ?? 'unknown'),
      fields: (parsed.fields as RunMetadata['fields']) ?? {
        list: 'unknown',
        filter: null,
        relation: null,
      },
      scenarios: (parsed.scenarios as RunMetadata['scenarios']) ?? [],
      intensity: (parsed.intensity as RunMetadata['intensity']) ?? {
        targetRps: 0,
        duration: '0s',
        stages: [],
      },
      mode: RUN_MODES.includes(parsed.mode as RunModeStr)
        ? (parsed.mode as RunMode)
        : 'read-only',
      seedSize: typeof parsed.seedSize === 'number' ? parsed.seedSize : null,
      seedDeterministicSeed:
        typeof parsed.seedDeterministicSeed === 'number'
          ? parsed.seedDeterministicSeed
          : null,
      partial: parsed.partial === true,
      partialFailureSource: PARTIAL_SOURCES.includes(
        parsed.partialFailureSource as PartialSource
      )
        ? (parsed.partialFailureSource as PartialSource)
        : null,
    };
  } catch (err) {
    params.stderr(`Error parsing ${metadataPath}: ${(err as Error).message}`);
    return { exitCode: 2 };
  }

  const pgSamplesCsvPath = join(runDir, 'pg-samples.csv');

  try {
    await renderReport({
      rawJsonPath,
      outDir: runDir,
      runMetadata: metadata,
      pgSamplesCsvPath,
      currentMaxCost: params.flags.currentMaxCost,
    });
  } catch (err) {
    params.stderr(`Error re-rendering ${runDir}: ${(err as Error).message}`);
    return { exitCode: 2 };
  }
  params.stdout(`Re-rendered ${runDir}`);
  return { exitCode: 0 };
}
