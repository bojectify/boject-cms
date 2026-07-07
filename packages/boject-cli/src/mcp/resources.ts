import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  BUNDLE_FORMAT_DOC,
  FIELD_TYPES_DOC,
  IDENTIFIER_RULES_DOC,
} from './resourceContent.js';
import { STARTER_NAMES, readStarter } from './starters.js';

function registerDoc(
  server: McpServer,
  name: string,
  uri: string,
  title: string,
  description: string,
  text: string
): void {
  server.registerResource(
    name,
    uri,
    { title, description, mimeType: 'text/markdown' },
    async (u) => ({
      contents: [{ uri: u.href, mimeType: 'text/markdown', text }],
    })
  );
}

export function registerResources(
  server: McpServer,
  startersDir: string
): void {
  registerDoc(
    server,
    'bundle-format',
    'boject://schema/bundle-format',
    'Bundle format',
    'The schema-as-code bundle shape for content-types/schema.boject.json.',
    BUNDLE_FORMAT_DOC
  );
  registerDoc(
    server,
    'field-types',
    'boject://schema/field-types',
    'Field types',
    'All content-type field types and their required options.',
    FIELD_TYPES_DOC
  );
  registerDoc(
    server,
    'identifier-rules',
    'boject://schema/identifier-rules',
    'Identifier rules',
    'Naming rules for content-type and field identifiers.',
    IDENTIFIER_RULES_DOC
  );
  for (const name of STARTER_NAMES) {
    server.registerResource(
      `starter-${name}`,
      `boject://starters/${name}`,
      {
        title: `Starter: ${name}`,
        description: `The ${name} starter as a worked example schema bundle.`,
        mimeType: 'application/json',
      },
      async (u) => ({
        contents: [
          {
            uri: u.href,
            mimeType: 'application/json',
            text: await readStarter(startersDir, name),
          },
        ],
      })
    );
  }
}
