import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpServer } from './server.js';
import { validateSchemaBundle } from '../validateSchemaBundle.js';
import { listStarterNames } from './starters.js';

const REPO_STARTERS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'starters'
);

async function connect() {
  const server = buildMcpServer({ startersDir: REPO_STARTERS });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, server };
}

describe('starter resources', () => {
  it('exposes a starter resource for every starter on disk', async () => {
    const { client, server } = await connect();
    const { resources } = await client.listResources();
    const uris = resources
      .map((r) => r.uri)
      .filter((u) => u.startsWith('boject://starters/'))
      .sort();
    const expected = listStarterNames(REPO_STARTERS)
      .map((n) => `boject://starters/${n}`)
      .sort();
    expect(uris).toEqual(expected);
    await client.close();
    await server.close();
  });

  it('web-base starter resource is a valid schema bundle', async () => {
    const { client, server } = await connect();
    const res = await client.readResource({
      uri: 'boject://starters/web-base',
    });
    const parsed = JSON.parse((res.contents[0] as { text: string }).text);
    expect(validateSchemaBundle(parsed).ok).toBe(true);
    await client.close();
    await server.close();
  });
});
