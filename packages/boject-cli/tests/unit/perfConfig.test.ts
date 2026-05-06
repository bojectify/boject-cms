import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProjectConfig } from '../../src/config.js';

async function withTempConfig(body: object): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'boject-cli-config-'));
  await writeFile(join(dir, '.boject.config.json'), JSON.stringify(body));
  return dir;
}

describe('loadProjectConfig — perf section', () => {
  it('accepts a config without a perf section (back-compat)', async () => {
    const dir = await withTempConfig({
      cms: { url: 'https://cms.example.com' },
      schema: { path: 'content-types/schema.boject.json' },
    });
    const r = await loadProjectConfig(dir);
    expect(r.config.perf).toBeUndefined();
  });

  it('parses a complete perf section', async () => {
    const dir = await withTempConfig({
      cms: { url: 'https://cms.example.com' },
      schema: { path: 'content-types/schema.boject.json' },
      perf: {
        contentType: 'Article',
        filterField: 'publishDate',
        relationField: 'author',
        out: './perf-reports',
      },
    });
    const r = await loadProjectConfig(dir);
    expect(r.config.perf).toEqual({
      contentType: 'Article',
      filterField: 'publishDate',
      relationField: 'author',
      out: './perf-reports',
    });
  });

  it('parses a partial perf section', async () => {
    const dir = await withTempConfig({
      cms: { url: 'https://cms.example.com' },
      schema: { path: 'content-types/schema.boject.json' },
      perf: { contentType: 'Article' },
    });
    const r = await loadProjectConfig(dir);
    expect(r.config.perf).toEqual({ contentType: 'Article' });
  });

  it('rejects a non-object perf value', async () => {
    const dir = await withTempConfig({
      cms: { url: 'https://cms.example.com' },
      schema: { path: 'content-types/schema.boject.json' },
      perf: 'wrong',
    });
    await expect(loadProjectConfig(dir)).rejects.toThrow(/perf/);
  });

  it('rejects a non-string perf.contentType', async () => {
    const dir = await withTempConfig({
      cms: { url: 'https://cms.example.com' },
      schema: { path: 'content-types/schema.boject.json' },
      perf: { contentType: 5 },
    });
    await expect(loadProjectConfig(dir)).rejects.toThrow(/perf\.contentType/);
  });
});
