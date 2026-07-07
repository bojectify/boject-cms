import { describe, expect, it, beforeAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const execFileP = promisify(execFile);
const PKG = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('boject mcp (built)', () => {
  beforeAll(async () => {
    await execFileP('pnpm', ['--filter', '@boject/cli', 'build'], {
      cwd: join(PKG, '..', '..'),
    });
  }, 120_000);

  it('serves the base starter over stdio', async () => {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [join(PKG, 'dist', 'index.js'), 'mcp'],
    });
    const client = new Client({ name: 'e2e', version: '0.0.0' });
    await client.connect(transport);
    const res = await client.readResource({ uri: 'boject://starters/base' });
    const content = res.contents[0];
    if (!content || !('text' in content)) {
      throw new Error('expected a text resource content');
    }
    expect(JSON.parse(content.text).version).toBe(2);
    await client.close();
  });
});
