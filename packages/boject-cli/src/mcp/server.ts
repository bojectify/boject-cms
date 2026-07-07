import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_VERSION } from '../version.js';
import { registerResources } from './resources.js';

export interface BuildMcpServerOptions {
  startersDir?: string;
}

function defaultStartersDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'starters');
}

/**
 * Build the boject MCP server with all resources/tools/prompts registered.
 * Transport-agnostic so tests can connect an in-memory transport and
 * `runMcp` can connect stdio. Later tasks register tools/prompts.
 */
export function buildMcpServer(options: BuildMcpServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'boject', version: CLI_VERSION });
  const startersDir = options.startersDir ?? defaultStartersDir();
  registerResources(server, startersDir);
  return server;
}
