import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpServer } from './server.js';

const validBundle = {
  version: 2,
  exportedAt: '2026-07-07T00:00:00.000Z',
  portable: true,
  contentTypes: [
    {
      id: null,
      identifier: 'Article',
      name: 'Article',
      description: null,
      fields: [
        {
          id: null,
          identifier: 'title',
          name: 'Title',
          type: 'ENTRY_TITLE',
          required: true,
          order: 0,
          options: null,
        },
      ],
    },
  ],
};

async function connect() {
  const server = buildMcpServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, server };
}

describe('validate_schema tool', () => {
  it('reports ok for a valid bundle', async () => {
    const { client, server } = await connect();
    const r = await client.callTool({
      name: 'validate_schema',
      arguments: { schema: validBundle },
    });
    expect(r.structuredContent).toMatchObject({ ok: true, issues: [] });
    await client.close();
    await server.close();
  });

  it('reports issues for an invalid bundle', async () => {
    const { client, server } = await connect();
    const r = await client.callTool({
      name: 'validate_schema',
      arguments: { schema: { ...validBundle, version: 1 } },
    });
    const structured = r.structuredContent as {
      ok: boolean;
      issues: unknown[];
    };
    expect(structured.ok).toBe(false);
    expect(structured.issues.length).toBeGreaterThan(0);
    await client.close();
    await server.close();
  });
});
