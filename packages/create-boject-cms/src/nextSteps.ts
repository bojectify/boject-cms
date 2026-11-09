export interface NextStepsParams {
  targetDir: string;
  hostPort: number;
  adminEmail: string;
  adminPassword: string;
  aiAssist: boolean;
  cliApiKeyCreated: boolean;
}

/** The "next steps" text printed after scaffolding. Never includes the CLI key. */
export function renderNextSteps({
  targetDir,
  hostPort,
  adminEmail,
  adminPassword,
  aiAssist,
  cliApiKeyCreated,
}: NextStepsParams): string {
  const aiNextSteps = aiAssist
    ? `
AI-assisted content modelling is set up (.mcp.json). To model your content,
open this folder in Claude Code, approve the "boject" server, then run:
  /mcp__boject__model_content
See "AI-assisted content modelling" in README.md for the full flow.
`
    : '';

  const cliKeyNextSteps = cliApiKeyCreated
    ? `
A CLI API key was saved to .env.local (gitignored). Once the CMS is running,
the boject CLI uses it automatically — e.g. npx @boject/cli@latest schema pull.
`
    : '';

  return `
Scaffolded boject-cms project at ${targetDir}

Next steps:
  cd ${targetDir}
  docker compose up -d

Once the container is healthy, log in at http://localhost:${hostPort}/login with:
  Email:    ${adminEmail}
  Password: ${adminPassword}

This password is also saved in .env — you will NOT see it again.
${cliKeyNextSteps}${aiNextSteps}`;
}
