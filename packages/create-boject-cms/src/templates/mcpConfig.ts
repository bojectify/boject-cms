/**
 * Emits the project-root `.mcp.json` wiring the boject Tier-A MCP server into
 * an MCP client (Claude Code). Runs locally via npx; needs no CMS/database.
 */
export function renderMcpConfig(): string {
  const config = {
    mcpServers: {
      boject: { command: 'npx', args: ['-y', '@boject/cli', 'mcp'] },
    },
  };
  return JSON.stringify(config, null, 2) + '\n';
}
