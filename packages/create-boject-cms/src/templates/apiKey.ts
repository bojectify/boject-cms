// The command a scaffolded project uses to mint its first API key (#506).
// Runs the key script that ships in the CMS image — `pnpm apikey:create` is a
// monorepo dev script and doesn't exist in a scaffolded project. Shared by
// the `.env` comment and the generated README; the scaffolder smoke test
// (scripts/smoke-test.sh) runs this exact command, so keep them in sync.

/** Scopes covering every `boject` CLI command that talks to the CMS. */
export const CLI_KEY_SCOPES = [
  'schema:read',
  'schema:write',
  'content:export',
  'content:import',
  'apikey:read',
  'apikey:write',
] as const;

export const FIRST_API_KEY_COMMAND = `docker compose exec cms tsx scripts/manage-api-keys/index.ts create cli --scopes ${CLI_KEY_SCOPES.join(',')}`;

/** Exports just the key from `.env` into the shell (not the whole file). */
export const EXPORT_API_KEY_COMMAND =
  "export BOJECT_API_KEY=$(sed -n 's/^BOJECT_API_KEY=//p' .env)";
