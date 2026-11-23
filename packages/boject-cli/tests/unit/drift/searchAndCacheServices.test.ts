import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { searchAndCacheServices } from '../../../src/drift/checks/searchAndCacheServices.js';
import { createDriftContext } from '../../../src/drift/context.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'boject-drift-sc-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const run = async () =>
  searchAndCacheServices.run(
    await createDriftContext({ root, version: null, shellEnv: {} })
  );

const ALL =
  'MEILI_URL=http://m:7700\nMEILI_MASTER_KEY=abc\nREDIS_URL=redis://r:6379\n';

describe('searchAndCacheServices', () => {
  it('has the expected metadata', () => {
    expect(searchAndCacheServices.id).toBe('search-and-cache-services');
    expect(searchAndCacheServices.appliesFrom).toBe('0.0.1-rc.2');
    expect(searchAndCacheServices.severity).toBe('required');
  });

  it('skipped when neither .env nor cms.environment exists', async () => {
    expect(await run()).toEqual({
      skipped: "no .env found, so the search/cache keys weren't checked",
    });
  });

  it('null when .env has all three keys', async () => {
    await writeFile(join(root, '.env'), ALL);
    expect(await run()).toBeNull();
  });

  it('finding lists only missing keys', async () => {
    await writeFile(join(root, '.env'), 'MEILI_URL=http://m:7700\n');
    const out = await run();
    expect(out).toMatchObject({
      title: 'This version needs Meilisearch and Redis',
      detail: [
        'Not set in .env or services.cms.environment: MEILI_MASTER_KEY, REDIS_URL',
      ],
    });
    const issue = out as { snippets: Array<{ file: string; text: string }> };
    expect(issue.snippets.map((s) => s.file)).toEqual([
      'docker-compose.yml',
      '.env',
    ]);
    const envText = issue.snippets[1].text;
    expect(envText).not.toMatch(/MEILI_URL=/);
    expect(envText).toMatch(/^MEILI_MASTER_KEY=[0-9a-f]{64}$/m);
    expect(envText).toContain('REDIS_URL=redis://redis:6379');
    expect(issue.snippets[0].text).toContain('  meilisearch:');
    expect(issue.snippets[0].text).toContain('  redis:');
  });

  it('empty value counts as missing', async () => {
    await writeFile(
      join(root, '.env'),
      'MEILI_URL=http://m:7700\nMEILI_MASTER_KEY=abc\nREDIS_URL=\n'
    );
    expect(await run()).toMatchObject({
      detail: ['Not set in .env or services.cms.environment: REDIS_URL'],
    });
  });

  it('compose environment map satisfies keys', async () => {
    await writeFile(
      join(root, 'docker-compose.yml'),
      `services:
  cms:
    environment:
      MEILI_URL: http://m:7700
      MEILI_MASTER_KEY: abc
      REDIS_URL: redis://r:6379
`
    );
    expect(await run()).toBeNull();
  });

  it('compose environment list form satisfies keys', async () => {
    await writeFile(
      join(root, 'docker-compose.yml'),
      `services:
  cms:
    environment:
      - MEILI_URL=http://m:7700
      - MEILI_MASTER_KEY=abc
      - REDIS_URL=redis://x
`
    );
    expect(await run()).toBeNull();
  });

  it('keys split across .env and compose count as set', async () => {
    await writeFile(join(root, '.env'), 'MEILI_URL=http://m:7700\n');
    await writeFile(
      join(root, 'docker-compose.yml'),
      `services:
  cms:
    environment:
      MEILI_MASTER_KEY: abc
      REDIS_URL: redis://r:6379
`
    );
    expect(await run()).toBeNull();
  });
});
