import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildMcpServer } from '../../mcp/server.js';

export interface RunMcpParams {
  stderr: (line: string) => void;
}

/**
 * Start the boject MCP server over stdio. Never writes to stdout (reserved
 * for JSON-RPC). Resolves only when the transport closes; the caller must
 * NOT process.exit() — the transport keeps the process alive on stdin.
 */
export async function runMcp(params: RunMcpParams): Promise<void> {
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  params.stderr('boject MCP server ready (stdio)');
}
