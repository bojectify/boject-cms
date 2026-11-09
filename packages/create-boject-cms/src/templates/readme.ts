import type { StarterChoice } from './envFile.js';
import { FIRST_API_KEY_COMMAND } from './apiKey.js';

export interface ReadmeParams {
  starter: StarterChoice;
  adminEmail: string;
  hostPort: number;
  aiAssist: boolean;
  /** A CLI key was generated into .env.local (#510). */
  cliApiKey?: boolean;
}

export function renderReadme({
  starter,
  adminEmail,
  hostPort,
  aiAssist,
  cliApiKey = false,
}: ReadmeParams): string {
  const starterLine =
    starter === 'none'
      ? ''
      : `The \`${starter}\` starter bundle will be imported on first boot.\n\n`;

  const aiSection = aiAssist
    ? `## AI-assisted content modelling

This project includes a \`.mcp.json\` that connects the [boject MCP server](https://www.npmjs.com/package/@boject/cli) to Claude Code, so you can design your content schema in a conversation — no CMS or database needs to be running.

1. Open this folder in Claude Code and run \`claude\`; accept the workspace-trust prompt.
2. Approve the \`boject\` server when asked (run \`/mcp\` any time to check its status).
3. Run the modelling prompt:

   \`\`\`
   /mcp__boject__model_content
   \`\`\`

   Optionally describe what you're building: \`/mcp__boject__model_content "a recipe site"\`.

Claude interviews you about your content, validates the result, and writes it to
\`content-types/schema.boject.json\`. Then run \`docker compose up -d\` to load it.

`
    : '';

  const apiKeySection = cliApiKey
    ? `## Your CLI API key

The [\`boject\` CLI](https://www.npmjs.com/package/@boject/cli) authenticates
with an API key. This project already has one: the raw key is in \`.env.local\`
(gitignored, never passed to the CMS container), and the CMS creates it on first
boot from the prefix and hash in \`.env\` (\`BOJECT_BOOTSTRAP_API_KEY\`). Once the
stack is running the CLI just works:

\`\`\`bash
npx @boject/cli@latest schema pull
\`\`\`

Its scopes cover \`boject schema\`, \`boject entries\` and \`boject apikey\`.

Scopes apply only when the key is first created: editing
\`BOJECT_BOOTSTRAP_API_KEY_SCOPES\` later has no effect (the CMS logs a warning).

To rotate it (for example after a suspected leak):

1. Mint the replacement in the CMS container (it writes to the database
   directly; \`boject apikey create\` can't mint keys with \`apikey:write\`,
   because API keys can't create other keys that can create keys):

   \`\`\`bash
   ${FIRST_API_KEY_COMMAND}
   \`\`\`

2. Put the new key in \`.env.local\` as \`BOJECT_API_KEY\`.
3. Remove \`BOJECT_BOOTSTRAP_API_KEY\` and \`BOJECT_BOOTSTRAP_API_KEY_SCOPES\`
   from \`.env\` — otherwise a later \`docker compose down -v\` would recreate the
   old key on the next boot.
4. Revoke the old one: \`boject apikey revoke <prefix>\` (via
   \`npx @boject/cli@latest\`; the prefix is the first 11 characters of the key).

Remove both variables outside local development too.

More keys use the same command, once the CMS is running:

\`\`\`bash
${FIRST_API_KEY_COMMAND}
\`\`\`

`
    : `## Create your first API key

The [\`boject\` CLI](https://www.npmjs.com/package/@boject/cli) authenticates
with an API key. A new project has none, so create one once the CMS is running:

\`\`\`bash
${FIRST_API_KEY_COMMAND}
\`\`\`

The raw key is printed once — copy it straight away. Save it in \`.env.local\`:

\`\`\`bash
echo 'BOJECT_API_KEY=<key>' >> .env.local
npx @boject/cli@latest schema pull
\`\`\`

The CLI loads \`.env.local\` (and then \`.env\`) from the project root
automatically, so there's nothing to export. \`.env.local\` is gitignored and,
unlike \`.env\`, isn't passed to the CMS container. A \`BOJECT_API_KEY\` set in
your shell takes precedence; set \`BOJECT_NO_DOTENV=1\` to stop the CLI reading
these files.

That key's scopes cover every CLI command group (run each as
\`npx @boject/cli@latest <command>\`):

| Command | Scope |
| --- | --- |
| \`boject schema pull\` / \`boject schema check\` | \`schema:read\` |
| \`boject schema apply\` | \`schema:write\` |
| \`boject entries export\` | \`content:export\` |
| \`boject entries import\` | \`content:import\` |
| \`boject apikey list\` | \`apikey:read\` |
| \`boject apikey create\` / \`boject apikey revoke\` | \`apikey:write\` |

With \`apikey:write\` you can mint narrower keys for other uses with
\`boject apikey create\` (for example \`content:read\` for a frontend calling
\`/api/public/*\` or \`/api/graphql\`).

`;

  return `# boject-cms

A new boject-cms project scaffolded by \`create-boject-cms\`.

## Start the CMS

\`\`\`bash
docker compose up -d
\`\`\`

This starts four services: the CMS, PostgreSQL, Meilisearch (search), and Redis
(response cache).

${starterLine}Once the container is healthy, log in at http://localhost:${hostPort}/login with:

- Email: \`${adminEmail}\`
- Password: see \`BOJECT_ADMIN_PASSWORD\` in \`.env\`

The CMS is published on host port \`${hostPort}\` — change \`BOJECT_HOST_PORT\` in
\`.env\` to run several projects side by side or to avoid a port clash.

${apiKeySection}## Content types

Your content type schema lives in \`content-types/schema.boject.json\` and is
applied to the database on every container boot. Edit it via the CMS UI in
development; commit the file alongside your code so production deploys converge
to the same schema. Destructive changes (removing types or fields) are blocked
by default — set \`BOJECT_ALLOW_DESTRUCTIVE_SCHEMA=true\` in \`.env\` to allow them.

${aiSection}## Stop the CMS

\`\`\`bash
docker compose down
\`\`\`

## Upgrade the CMS image

\`\`\`bash
pnpm upgrade
\`\`\`

This runs \`npx @boject/cli@latest upgrade\` to rewrite the pinned image tag in \`docker-compose.yml\` and restart the container.
`;
}
