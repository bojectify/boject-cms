import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpServer } from './server.js';

async function connect() {
  const server = buildMcpServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, server };
}

describe('knowledge resources', () => {
  it('exposes the three schema resources', async () => {
    const { client, server } = await connect();
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain('boject://schema/bundle-format');
    expect(uris).toContain('boject://schema/field-types');
    expect(uris).toContain('boject://schema/identifier-rules');
    await client.close();
    await server.close();
  });

  it('field-types resource lists every field type', async () => {
    const { client, server } = await connect();
    const res = await client.readResource({
      uri: 'boject://schema/field-types',
    });
    const text = (res.contents[0] as { text: string }).text;
    for (const t of [
      'ENTRY_TITLE',
      'SLUG',
      'RELATION',
      'MULTIRELATION',
      'IMAGE',
      'SELECT',
    ]) {
      expect(text).toContain(t);
    }
    await client.close();
    await server.close();
  });

  it('identifier-rules resource states both casing rules', async () => {
    const { client, server } = await connect();
    const res = await client.readResource({
      uri: 'boject://schema/identifier-rules',
    });
    const text = (res.contents[0] as { text: string }).text;
    expect(text).toContain('/^[A-Z][a-zA-Z0-9]*$/');
    expect(text).toContain('/^[a-z][a-zA-Z0-9]*$/');
    await client.close();
    await server.close();
  });
});
