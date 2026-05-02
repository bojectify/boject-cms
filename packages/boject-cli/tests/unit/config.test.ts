import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadProjectConfig } from '../../src/config.js';

let workDir: string;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'boject-cli-config-'));
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('loadProjectConfig', () => {
  it('finds .boject.config.json in the cwd', async () => {
    await writeFile(
      join(workDir, '.boject.config.json'),
      JSON.stringify({
        cms: { url: 'http://localhost:4000' },
        schema: { path: 'content-types/schema.boject.json' },
      })
    );
    const result = await loadProjectConfig(workDir);
    expect(result.config.cms.url).toBe('http://localhost:4000');
    expect(result.config.schema.path).toBe('content-types/schema.boject.json');
    expect(result.configPath).toBe(join(workDir, '.boject.config.json'));
  });

  it('walks up to find .boject.config.json from a subdirectory', async () => {
    await writeFile(
      join(workDir, '.boject.config.json'),
      JSON.stringify({
        cms: { url: 'http://localhost:4000' },
        schema: { path: 'content-types/schema.boject.json' },
      })
    );
    const sub = join(workDir, 'apps', 'cms', 'server');
    await mkdir(sub, { recursive: true });
    const result = await loadProjectConfig(sub);
    expect(result.configPath).toBe(join(workDir, '.boject.config.json'));
  });

  it('throws when no config is found', async () => {
    await expect(loadProjectConfig(workDir)).rejects.toThrow(
      /No .boject.config.json/
    );
  });

  it('throws when the config is invalid JSON', async () => {
    await writeFile(join(workDir, '.boject.config.json'), '{invalid');
    await expect(loadProjectConfig(workDir)).rejects.toThrow(/parse/i);
  });

  it('throws when required fields are missing', async () => {
    await writeFile(
      join(workDir, '.boject.config.json'),
      JSON.stringify({ cms: { url: 'http://localhost:4000' } })
    );
    await expect(loadProjectConfig(workDir)).rejects.toThrow(/schema\.path/);
  });
});
