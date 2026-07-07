import type { StarterChoice } from './envFile.js';

export interface ReadmeParams {
  starter: StarterChoice;
  adminEmail: string;
  hostPort: number;
}

export function renderReadme({
  starter,
  adminEmail,
  hostPort,
}: ReadmeParams): string {
  const starterLine =
    starter === 'none'
      ? ''
      : `The \`${starter}\` starter bundle will be imported on first boot.\n\n`;

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

## Content types

Your content type schema lives in \`content-types/schema.boject.json\` and is
applied to the database on every container boot. Edit it via the CMS UI in
development; commit the file alongside your code so production deploys converge
to the same schema. Destructive changes (removing types or fields) are blocked
by default — set \`BOJECT_ALLOW_DESTRUCTIVE_SCHEMA=true\` in \`.env\` to allow them.

## Stop the CMS

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
