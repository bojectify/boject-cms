import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runUpgrade } from '../../src/commands/upgrade.js';

vi.mock('../../src/registry.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/registry.js')>(
    '../../src/registry.js'
  );
  return {
    ...actual,
    listTags: vi.fn(),
  };
});

vi.mock('../../src/health.js', () => ({
  pollHealth: vi.fn(),
}));

import { listTags } from '../../src/registry.js';
import { pollHealth } from '../../src/health.js';

const FIXTURE = `services:
  cms:
    image: ghcr.io/bojectify/boject-cms:1.0.0
  db:
    image: postgres:17
`;

let workDir: string;
const calls: Array<{ cmd: string; args: string[] }> = [];
const runner = {
  run: vi.fn(async (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return { status: 0 };
  }),
};

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'boject-upgrade-'));
  await writeFile(join(workDir, 'docker-compose.yml'), FIXTURE);
  calls.length = 0;
  runner.run.mockClear();
  vi.mocked(listTags).mockReset();
  vi.mocked(pollHealth).mockReset();
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('runUpgrade', () => {
  it('applies the upgrade: rewrite + pull + up + health poll', async () => {
    vi.mocked(listTags).mockResolvedValueOnce(['1.0.0', '1.1.0', 'latest']);
    vi.mocked(pollHealth).mockResolvedValueOnce(undefined);
    const { exitCode, message } = await runUpgrade({
      cwd: workDir,
      runner,
      stdout: () => {},
      stderr: () => {},
    });
    expect(exitCode).toBe(0);
    expect(message).toContain('Upgraded 1.0.0 → 1.1.0');
    const out = await readFile(join(workDir, 'docker-compose.yml'), 'utf8');
    expect(out).toContain('image: ghcr.io/bojectify/boject-cms:1.1.0');
    expect(calls).toEqual([
      { cmd: 'docker', args: ['compose', 'pull', 'cms'] },
      { cmd: 'docker', args: ['compose', 'up', '-d'] },
    ]);
    expect(vi.mocked(pollHealth)).toHaveBeenCalledOnce();
  });

  it('exits 0 with "Already on" when the latest semver matches current', async () => {
    vi.mocked(listTags).mockResolvedValueOnce(['0.9.0', '1.0.0']);
    const { exitCode, message } = await runUpgrade({
      cwd: workDir,
      runner,
      stdout: () => {},
      stderr: () => {},
    });
    expect(exitCode).toBe(0);
    expect(message).toContain('Already on 1.0.0');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('--dry-run prints the diff and leaves the file untouched', async () => {
    vi.mocked(listTags).mockResolvedValueOnce(['1.0.0', '1.2.0']);
    const { exitCode, message } = await runUpgrade({
      cwd: workDir,
      runner,
      flags: { dryRun: true },
      stdout: () => {},
      stderr: () => {},
    });
    expect(exitCode).toBe(0);
    expect(message).toContain('- image: bojectify/boject-cms:1.0.0');
    expect(message).toContain('+ image: bojectify/boject-cms:1.2.0');
    const out = await readFile(join(workDir, 'docker-compose.yml'), 'utf8');
    expect(out).toContain('image: ghcr.io/bojectify/boject-cms:1.0.0');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('--check exits 1 with "Update available" when an upgrade exists', async () => {
    vi.mocked(listTags).mockResolvedValueOnce(['1.0.0', '1.2.0']);
    const { exitCode, message } = await runUpgrade({
      cwd: workDir,
      runner,
      flags: { check: true },
      stdout: () => {},
      stderr: () => {},
    });
    expect(exitCode).toBe(1);
    expect(message).toContain('Update available: 1.0.0 → 1.2.0');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('--check exits 0 with "Up to date" when no upgrade exists', async () => {
    vi.mocked(listTags).mockResolvedValueOnce(['0.9.0', '1.0.0']);
    const { exitCode, message } = await runUpgrade({
      cwd: workDir,
      runner,
      flags: { check: true },
      stdout: () => {},
      stderr: () => {},
    });
    expect(exitCode).toBe(0);
    expect(message).toContain('Up to date: 1.0.0');
  });

  it('--to <version> bypasses tag discovery', async () => {
    vi.mocked(pollHealth).mockResolvedValueOnce(undefined);
    const { exitCode, message } = await runUpgrade({
      cwd: workDir,
      runner,
      flags: { to: '0.5.0' },
      stdout: () => {},
      stderr: () => {},
    });
    expect(vi.mocked(listTags)).not.toHaveBeenCalled();
    expect(exitCode).toBe(0);
    expect(message).toContain('Upgraded 1.0.0 → 0.5.0');
  });

  it('exits 1 when tag discovery yields no semver tags and no --to is given', async () => {
    vi.mocked(listTags).mockResolvedValueOnce(['latest', 'dev']);
    const { exitCode, message } = await runUpgrade({
      cwd: workDir,
      runner,
      stdout: () => {},
      stderr: () => {},
    });
    expect(exitCode).toBe(1);
    expect(message).toMatch(/no semver tags/i);
  });

  describe('health check URL (#503)', () => {
    async function writeConfig(cmsUrl: string): Promise<void> {
      await writeFile(
        join(workDir, '.boject.config.json'),
        JSON.stringify({
          cms: { url: cmsUrl },
          schema: { path: 'content-types/schema.boject.json' },
        })
      );
    }

    async function upgrade(
      flags: { url?: string } = {},
      stderr: (line: string) => void = () => {}
    ) {
      return runUpgrade({
        cwd: workDir,
        runner,
        flags: { to: '1.1.0', ...flags },
        stdout: () => {},
        stderr,
      });
    }

    it('polls cms.url from .boject.config.json (non-default port)', async () => {
      await writeConfig('http://localhost:4100');
      vi.mocked(pollHealth).mockResolvedValueOnce(undefined);
      const { exitCode } = await upgrade();
      expect(exitCode).toBe(0);
      expect(vi.mocked(pollHealth)).toHaveBeenCalledWith(
        'http://localhost:4100/api/health',
        expect.anything()
      );
    });

    it('strips a trailing slash from cms.url', async () => {
      await writeConfig('http://localhost:4100/');
      vi.mocked(pollHealth).mockResolvedValueOnce(undefined);
      await upgrade();
      expect(vi.mocked(pollHealth)).toHaveBeenCalledWith(
        'http://localhost:4100/api/health',
        expect.anything()
      );
    });

    it('--url overrides cms.url', async () => {
      await writeConfig('http://localhost:4100');
      vi.mocked(pollHealth).mockResolvedValueOnce(undefined);
      await upgrade({ url: 'http://cms.internal:8080' });
      expect(vi.mocked(pollHealth)).toHaveBeenCalledWith(
        'http://cms.internal:8080/api/health',
        expect.anything()
      );
    });

    it('falls back to http://localhost:4000 when there is no config file', async () => {
      vi.mocked(pollHealth).mockResolvedValueOnce(undefined);
      const stderr = vi.fn();
      await upgrade({}, stderr);
      expect(vi.mocked(pollHealth)).toHaveBeenCalledWith(
        'http://localhost:4000/api/health',
        expect.anything()
      );
      expect(stderr).not.toHaveBeenCalled();
    });

    it('warns and falls back to the default when the config is invalid', async () => {
      await writeFile(join(workDir, '.boject.config.json'), '{ not json');
      vi.mocked(pollHealth).mockResolvedValueOnce(undefined);
      const stderr = vi.fn();
      const { exitCode } = await upgrade({}, stderr);
      expect(exitCode).toBe(0);
      expect(vi.mocked(pollHealth)).toHaveBeenCalledWith(
        'http://localhost:4000/api/health',
        expect.anything()
      );
      expect(stderr).toHaveBeenCalledWith(
        expect.stringMatching(
          /^Warning: .*\.boject\.config\.json.*localhost:4000/
        )
      );
    });

    it('reports a health-check failure after a successful restart as such', async () => {
      await writeConfig('http://localhost:4100');
      vi.mocked(pollHealth).mockRejectedValueOnce(
        new Error(
          'Health check at http://localhost:4100/api/health timed out after 120000ms'
        )
      );
      const { exitCode, message } = await upgrade();
      expect(exitCode).toBe(1);
      expect(message).toContain('1.0.0 → 1.1.0');
      expect(message).toMatch(/restarted/i);
      expect(message).toContain('http://localhost:4100/api/health');
      expect(message).toContain('docker compose logs cms');
      const out = await readFile(join(workDir, 'docker-compose.yml'), 'utf8');
      expect(out).toContain('image: ghcr.io/bojectify/boject-cms:1.1.0');
    });
  });
});
