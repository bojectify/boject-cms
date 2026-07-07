import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CLI_VERSION } from '../version.js';

export interface BuildMcpServerOptions {
  startersDir?: string;
}

/**
 * Build the boject MCP server with all resources/tools/prompts registered.
 * Transport-agnostic so tests can connect an in-memory transport and
 * `runMcp` can connect stdio. Later tasks register resources/tools/prompts.
 */
export function buildMcpServer(
  _options: BuildMcpServerOptions = {}
): McpServer {
  const server = new McpServer({ name: 'boject', version: CLI_VERSION });
  return server;
}
