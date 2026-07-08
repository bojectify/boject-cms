import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { validateSchemaBundle } from '../validateSchemaBundle.js';

export function registerTools(server: McpServer): void {
  server.registerTool(
    'validate_schema',
    {
      title: 'Validate schema bundle',
      description:
        'Validate a schema-as-code bundle (the content-types/schema.boject.json shape). ' +
        'Returns { ok, issues } where each issue has { path, message, kind }. ' +
        'kind="shape" is a structural error; kind="plan" is a cross-reference error ' +
        '(e.g. a relation targeting an unknown content type). No CMS connection required.',
      inputSchema: { schema: z.record(z.string(), z.unknown()) },
    },
    ({ schema }) => {
      const result = validateSchemaBundle(schema);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        // Spread into a fresh object literal: the MCP SDK's structuredContent
        // field is typed as a bare index signature (Record<string, unknown>),
        // which the named SchemaValidation interface doesn't structurally
        // satisfy directly (TS requires an explicit index signature for a
        // stored/named type, but permits it for a literal expression).
        structuredContent: { ...result },
      };
    }
  );
}
