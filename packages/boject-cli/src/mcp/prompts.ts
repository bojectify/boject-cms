import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'model_content',
    {
      title: 'Model my content',
      description:
        'Start a guided session to design a boject content schema and write it to disk.',
      argsSchema: { description: z.string().optional() },
    },
    ({ description }) => {
      const intro = description
        ? `The user wants to model: ${description}.`
        : 'The user wants to model their content.';
      const text = [
        `You are helping author a boject-cms content schema. ${intro}`,
        '',
        'Steps:',
        '1. Read these resources for ground truth:',
        '   - boject://schema/bundle-format',
        '   - boject://schema/field-types',
        '   - boject://schema/identifier-rules',
        '   - boject://starters/base (a worked example)',
        '2. Interview the user about their domain: what things they publish, the',
        '   fields each needs, and how they relate. Ask one question at a time.',
        '3. Produce a schema-as-code bundle (version 2, portable, contentTypes[]).',
        '   Use PascalCase content-type identifiers and camelCase field identifiers.',
        '   Give every content type exactly one ENTRY_TITLE field.',
        '4. Call the validate_schema tool and fix every reported issue until ok=true.',
        '5. Write the validated bundle to content-types/schema.boject.json.',
      ].join('\n');
      return {
        messages: [{ role: 'user', content: { type: 'text', text } }],
      };
    }
  );
}
