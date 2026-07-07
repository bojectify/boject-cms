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

describe('model_content prompt', () => {
  it('returns a message referencing the resources, tool, and output path', async () => {
    const { client, server } = await connect();
    const { messages } = await client.getPrompt({
      name: 'model_content',
      arguments: { description: 'a recipe site' },
    });
    const text = messages
      .map((m) => (m.content.type === 'text' ? m.content.text : ''))
      .join('\n');
    expect(text).toContain('boject://schema/bundle-format');
    expect(text).toContain('validate_schema');
    expect(text).toContain('content-types/schema.boject.json');
    expect(text).toContain('a recipe site');
    await client.close();
    await server.close();
  });
});
