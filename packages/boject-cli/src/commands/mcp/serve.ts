import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildMcpServer } from '../../mcp/server.js';

export interface RunMcpParams {
  stderr: (line: string) => void;
}

/**
 * Start the boject MCP server over stdio. Never writes to stdout (reserved
 * for JSON-RPC). Resolves once the transport is connected; the process then
 * stays alive via the transport's stdin listener, so the caller must NOT
 * process.exit().
 */
export async function runMcp(params: RunMcpParams): Promise<void> {
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  params.stderr('boject MCP server ready (stdio)');
}
