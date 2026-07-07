import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpServer } from './server.js';
import { validateSchemaBundle } from '../validateSchemaBundle.js';

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
  it('exposes base/sport/rugby starter resources', async () => {
    const { client, server } = await connect();
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain('boject://starters/base');
    expect(uris).toContain('boject://starters/sport');
    expect(uris).toContain('boject://starters/rugby');
    await client.close();
    await server.close();
  });

  it('base starter resource is a valid schema bundle', async () => {
    const { client, server } = await connect();
    const res = await client.readResource({ uri: 'boject://starters/base' });
    const parsed = JSON.parse((res.contents[0] as { text: string }).text);
    expect(validateSchemaBundle(parsed).ok).toBe(true);
    await client.close();
    await server.close();
  });
});
