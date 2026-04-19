import type { StarterChoice } from './envFile.js';

export interface ReadmeParams {
  starter: StarterChoice;
  adminEmail: string;
}

export function renderReadme({ starter, adminEmail }: ReadmeParams): string {
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

${starterLine}Once the container is healthy, log in at http://localhost:4000/login with:

- Email: \`${adminEmail}\`
- Password: see \`BOJECT_ADMIN_PASSWORD\` in \`.env\`

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
