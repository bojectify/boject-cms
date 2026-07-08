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
        `You are helping a user design their boject-cms content model from scratch. ${intro}`,
        '',
        'Start by understanding the project, THEN model it. Do not open with a',
        'list of content types or ask the user to pick from one.',
        '',
        'Steps:',
        '1. Read these resources for ground truth (no need to narrate this step):',
        '   - boject://schema/bundle-format',
        '   - boject://schema/field-types',
        '   - boject://schema/identifier-rules',
        '   - boject://starters/articles (an example to draw on, NOT a menu to pick from)',
        '2. Understand the project first. Ask, one question at a time and in plain',
        '   language: what are they building and who is it for, then what kinds of',
        '   content it will hold. Do not propose content types until you understand',
        '   the domain.',
        '3. Propose a first set of content types and their key fields in prose, and',
        '   confirm with the user before writing any JSON.',
        '4. Produce a schema-as-code bundle (version 2, portable, contentTypes[]).',
        '   Use PascalCase content-type identifiers and camelCase field identifiers.',
        '   Give every content type exactly one ENTRY_TITLE field.',
        '5. Call the validate_schema tool and fix every reported issue until ok=true.',
        '6. Write the validated bundle to content-types/schema.boject.json.',
      ].join('\n');
      return {
        messages: [{ role: 'user', content: { type: 'text', text } }],
      };
    }
  );
}
