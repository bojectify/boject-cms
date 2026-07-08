import { describe, expect, it } from 'vitest';
import { renderMcpConfig } from '../../src/templates/mcpConfig.js';

describe('renderMcpConfig', () => {
  it('emits the boject stdio MCP server config', () => {
    const out = renderMcpConfig();
    expect(JSON.parse(out)).toEqual({
      mcpServers: {
        boject: { command: 'npx', args: ['-y', '@boject/cli', 'mcp'] },
      },
    });
  });

  it('ends with a trailing newline and is deterministic', () => {
    expect(renderMcpConfig().endsWith('\n')).toBe(true);
    expect(renderMcpConfig()).toBe(renderMcpConfig());
  });
});
