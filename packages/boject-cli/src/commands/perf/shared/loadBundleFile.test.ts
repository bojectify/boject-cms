import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadBundleFile } from './loadBundleFile.js';
import { FIELD_TYPES } from '../../../vendor/fieldTypes.js';

async function withTempBundle(content: object | string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'boject-bundle-'));
  const path = join(dir, 'bundle.json');
  await writeFile(
    path,
    typeof content === 'string' ? content : JSON.stringify(content)
  );
  return path;
}

describe('loadBundleFile', () => {
  it('loads a valid bundle and returns it parsed', async () => {
    const path = await withTempBundle({
      version: 2,
      exportedAt: '2026-05-07T00:00:00.000Z',
      portable: false,
      contentTypes: [
        {
          id: 'ct-page',
          identifier: 'Page',
          name: 'Page',
          description: null,
          fields: [
            {
              id: 'f1',
              identifier: 'title',
              name: 'Title',
              type: FIELD_TYPES.ENTRY_TITLE,
              required: true,
              unique: true,
              order: 0,
              options: null,
            },
          ],
        },
      ],
    });
    const bundle = await loadBundleFile(path);
    expect(bundle.contentTypes).toHaveLength(1);
  });

  it('throws on malformed JSON', async () => {
    const path = await withTempBundle('{ bad json');
    await expect(loadBundleFile(path)).rejects.toThrow(/JSON/i);
  });

  it('throws on a bundle that fails validateBundle', async () => {
    const path = await withTempBundle({
      version: 2,
      exportedAt: '2026-05-07T00:00:00.000Z',
      portable: false,
      contentTypes: [{ identifier: '' }], // invalid
    });
    await expect(loadBundleFile(path)).rejects.toThrow(/validation/i);
  });
});
