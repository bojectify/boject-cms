import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpServer } from './server.js';

async function connect() {
  const server = buildMcpServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return { client, server };
}

describe('buildMcpServer', () => {
  it('connects and advertises the boject server', async () => {
    const { client, server } = await connect();
    expect(client.getServerVersion()?.name).toBe('boject');
    await client.close();
    await server.close();
  });
});
