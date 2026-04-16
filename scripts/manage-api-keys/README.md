# manage-api-keys

CLI for creating, listing, and revoking API keys. API keys authenticate external consumers of the REST and GraphQL APIs via the `Authorization: Bearer boject_...` header.

Run `pnpm apikey:create --help` (or any other subcommand with `--help` / `-h`) for inline usage.

## Commands

| Command                                       | Script                                    | Description                                                 |
| --------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------- |
| `pnpm apikey:create <name>`                   | `scripts/manage-api-keys/index.ts create` | Generate a new API key. Prints the raw key **once**.        |
| `pnpm apikey:list`                            | `scripts/manage-api-keys/index.ts list`   | List every key with prefix, name, status, last-used.        |
| `pnpm apikey:revoke <prefix>`                 | `scripts/manage-api-keys/index.ts revoke` | Soft-revoke an active key by prefix (sets `revokedAt`).     |
| `tsx scripts/manage-api-keys/index.ts --help` | —                                         | Print usage (also available as `-h` or the `help` command). |

## Flags

| Flag           | Description           |
| -------------- | --------------------- |
| `--help`, `-h` | Print usage and exit. |

## How storage works

- Keys are SHA-256 hashed before insert. The raw key is **only** shown at creation time — there is no way to recover it later.
- Each key stores an 11-character `keyPrefix` (e.g. `boject_a1b`) for human identification in `list` and `revoke`.
- `revoke` is a soft delete: it sets `revokedAt` on the row so the record stays for audit. The `auth` middleware rejects any key whose `revokedAt` is not null.
- `lastUsedAt` is updated fire-and-forget on every valid authenticated request.

## Requirements

- `DATABASE_URL` must be set (loaded from `.env`). The CLI connects directly via a standalone Prisma client using the PG driver adapter — it does not go through Nitro.
- Run against the database you actually want to mutate. `pnpm apikey:*` always uses `DATABASE_URL`; prefix with `DATABASE_URL=...` to target a different environment.

## Examples

```bash
# Create a new key
pnpm apikey:create "Mobile app backend"

# List all keys
pnpm apikey:list

# Revoke by prefix
pnpm apikey:revoke boject_a1b

# Print help
pnpm apikey:create --help
```

## Related

- `server/utils/apiKey.ts` — `generateApiKey()` / `hashApiKey()` helpers used by this CLI.
- `server/utils/validateApiKey.ts` — Runtime validation of incoming Bearer tokens.
- `server/middleware/auth.ts` — Global middleware enforcing either session or API key auth on `/api/*`.
- `prisma/seed.ts` — Seeds a deterministic test key used by integration tests.
