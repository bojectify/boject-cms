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
        `You are helping a user design their boject-cms content model. ${intro}`,
        '',
        'Their project already has a starter schema at',
        'content-types/schema.boject.json — the content types from the starter they',
        'chose when scaffolding (or empty if they chose the "none" starter). Build ON',
        'TOP of it; do not replace it.',
        '',
        'Start by understanding the project and its existing schema, THEN model.',
        'Do not open with a list of content types or ask the user to pick from one.',
        '',
        'Steps:',
        '1. Read these resources for ground truth (no need to narrate this step):',
        '   - boject://schema/bundle-format',
        '   - boject://schema/field-types',
        '   - boject://schema/identifier-rules',
        '   - boject://starters/articles (a well-formed example to draw on, NOT a menu)',
        "2. Read the project's existing content-types/schema.boject.json. Its",
        '   contentTypes[] came from the chosen starter (empty for the "none" starter).',
        "   Treat those as the user's foundation — keep them unless the user explicitly",
        '   asks to remove them.',
        '3. Understand the project first. Ask, one question at a time and in plain',
        '   language: what are they building and who is it for, then what kinds of',
        '   content it will hold. Do not propose changes until you understand the',
        '   domain.',
        '4. Propose, in prose, the content types to ADD and any changes to existing',
        '   ones, and confirm with the user before writing any JSON. If the starter',
        '   already covers a need, say so rather than duplicating it.',
        '5. Produce the updated schema-as-code bundle (version 2, portable,',
        "   contentTypes[]) — the starter's types plus your additions/edits. Use",
        '   PascalCase content-type identifiers and camelCase field identifiers. Give',
        '   every content type exactly one ENTRY_TITLE field.',
        '6. Call the validate_schema tool and fix every reported issue until ok=true.',
        '7. Write the validated bundle to content-types/schema.boject.json.',
        '',
        'The schema is editable two ways: through a session like this, or directly as',
        'schema-as-code with the boject CLI — `boject schema pull` (fetch the live',
        'schema), `boject schema validate` (check a bundle offline), and `boject schema',
        'apply` (push changes to a running CMS).',
      ].join('\n');
      return {
        messages: [{ role: 'user', content: { type: 'text', text } }],
      };
    }
  );
}
