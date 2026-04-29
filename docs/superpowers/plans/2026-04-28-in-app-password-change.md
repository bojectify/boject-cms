# In-app Password Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a self-service password-change flow for any logged-in CMS user — `/account` page → `POST /api/account/password` → cross-device session invalidation via `User.passwordVersion`, sharing strength validation with the first-boot seed.

**Architecture:** A shared validator at `apps/cms/utils/validatePassword.ts` runs on both client (live requirements panel) and server (defense-in-depth on the endpoint and at first-boot seed time). Sessions invalidate across devices via `User.passwordVersion` — copied into the cookie at login, checked in the auth middleware, bumped on change, with the current device's cookie re-issued so the active user stays signed in.

**Tech Stack:** Nuxt 4 + Nitro, Vue 3 + Nuxt UI, Prisma v7, nuxt-auth-utils (encrypted cookie sessions), Vitest, scrypt via `nuxt-auth-utils`'s `verifyPassword` / `hashPassword`.

**Spec:** `docs/superpowers/specs/2026-04-28-in-app-password-change-design.md`

---

## Task 1: Shared password validator

Builds the foundation — pure module with no Nuxt or Prisma dependencies, usable from the Nuxt client, the Nuxt server, and `tsx`-run scripts. Replaces the inline validator currently embedded in `seed-admin.ts`.

**Files:**

- Create: `apps/cms/utils/validatePassword.ts`
- Create: `apps/cms/utils/validatePassword.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/cms/utils/validatePassword.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_RULES,
  validatePassword,
} from './validatePassword';

describe('validatePassword', () => {
  const email = 'admin@example.com';

  it('accepts a strong password', () => {
    expect(validatePassword('R8#fT2!qwLpZ', { email })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it('rejects passwords shorter than the minimum length', () => {
    const result = validatePassword('short1!', { email });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain('length');
  });

  it.each([
    'password',
    'PASSWORD',
    'changeme',
    'admin',
    'qwertyuiop',
    '123456789',
  ])('rejects blocklisted password %s (case-insensitive)', (pw) => {
    const result = validatePassword(pw, { email });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain('blocklist');
  });

  it('rejects passwords matching the email local-part', () => {
    const result = validatePassword('verylongusername', {
      email: 'verylongusername@example.com',
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain('localPart');
  });

  it('is case-insensitive against the email local-part', () => {
    const result = validatePassword('VeryLongUsername', {
      email: 'verylongusername@example.com',
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain('localPart');
  });

  it('returns all failure ids when multiple rules fail', () => {
    // 'admin' is short AND blocklisted AND matches local-part of admin@x.com
    const result = validatePassword('admin', { email: 'admin@example.com' });
    expect(result.ok).toBe(false);
    expect(result.failures.sort()).toEqual(
      ['blocklist', 'length', 'localPart'].sort()
    );
  });

  it('exposes MIN_PASSWORD_LENGTH constant', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
  });

  it('exposes PASSWORD_RULES registry with stable ids', () => {
    expect(PASSWORD_RULES.map((r) => r.id).sort()).toEqual(
      ['blocklist', 'length', 'localPart'].sort()
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter cms vitest run apps/cms/utils/validatePassword.test.ts`

Expected: FAIL with module-not-found or undefined imports.

- [ ] **Step 3: Implement the validator**

Create `apps/cms/utils/validatePassword.ts`:

```ts
const WEAK_PASSWORD_BLOCKLIST = new Set([
  'password',
  'password123',
  'admin',
  'administrator',
  'boject',
  'changeme',
  'qwerty',
  'qwertyuiop',
  'letmein',
  '12345678',
  '123456789',
  '1234567890',
  'iloveyou',
]);

export const MIN_PASSWORD_LENGTH = 12;

export type PasswordRuleId = 'length' | 'blocklist' | 'localPart';

export interface PasswordRule {
  id: PasswordRuleId;
  label: string;
  test: (password: string, ctx: { email: string }) => boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    id: 'length',
    label: `At least ${MIN_PASSWORD_LENGTH} characters`,
    test: (pw) => pw.length >= MIN_PASSWORD_LENGTH,
  },
  {
    id: 'blocklist',
    label: 'Not on the common-password blocklist',
    test: (pw) => !WEAK_PASSWORD_BLOCKLIST.has(pw.toLowerCase()),
  },
  {
    id: 'localPart',
    label: 'Different from the local-part of your email',
    test: (pw, { email }) => {
      const local = email.split('@')[0]?.toLowerCase() ?? '';
      return local.length === 0 || pw.toLowerCase() !== local;
    },
  },
];

export interface PasswordValidationResult {
  ok: boolean;
  failures: PasswordRuleId[];
}

export function validatePassword(
  password: string,
  ctx: { email: string }
): PasswordValidationResult {
  const failures = PASSWORD_RULES.filter(
    (rule) => !rule.test(password, ctx)
  ).map((rule) => rule.id);
  return { ok: failures.length === 0, failures };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter cms vitest run apps/cms/utils/validatePassword.test.ts`

Expected: PASS, all 9 cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/utils/validatePassword.ts apps/cms/utils/validatePassword.test.ts
git commit -m "feat(validator): shared password validator (client + server)"
```

---

## Task 2: Migrate `seed-admin.ts` onto the shared validator

Removes duplication between the seed CLI and the upcoming endpoint. The CLI keeps its existing string-message contract by joining failure labels.

**Files:**

- Modify: `apps/cms/scripts/docker-entrypoint/seed-admin.ts`
- Modify: `apps/cms/scripts/docker-entrypoint/seed-admin.test.ts`

- [ ] **Step 1: Update the seed-admin module**

Open `apps/cms/scripts/docker-entrypoint/seed-admin.ts`. Replace the local `WEAK_PASSWORD_BLOCKLIST`, `MIN_ADMIN_PASSWORD_LENGTH`, `AdminPasswordValidation`, and `validateAdminPassword` symbols with an import from the shared module, and rewrite the CLI's failure path to use the new shape.

Specifically:

Replace:

```ts
export const MIN_ADMIN_PASSWORD_LENGTH = 12;

const WEAK_PASSWORD_BLOCKLIST = new Set([
  'password',
  'password123',
  'admin',
  // … etc …
]);

export type AdminPasswordValidation =
  | { ok: true }
  | { ok: false; reason: string };

export function validateAdminPassword(
  password: string,
  email: string
): AdminPasswordValidation {
  // … local rules …
}
```

with:

```ts
import { PASSWORD_RULES, validatePassword } from '../../utils/validatePassword';
```

In the CLI entry block (where today's `validation = validateAdminPassword(password, email)` lives), change:

```ts
const validation = validateAdminPassword(password, email);
if (!validation.ok) {
  console.error(`[seed-admin] ${validation.reason}`);
  process.exit(1);
}
```

to:

```ts
const result = validatePassword(password, { email });
if (!result.ok) {
  const messages = result.failures.map(
    (id) => PASSWORD_RULES.find((r) => r.id === id)!.label
  );
  console.error(`[seed-admin] BOJECT_ADMIN_PASSWORD: ${messages.join('; ')}`);
  process.exit(1);
}
```

- [ ] **Step 2: Update the seed-admin tests**

Open `apps/cms/scripts/docker-entrypoint/seed-admin.test.ts`. Drop the `describe('validateAdminPassword', …)` block — its rules are now covered by `validatePassword.test.ts`. Keep the `describe('seedAdminIfEmpty', …)` block exactly as it is.

After removal, `seed-admin.test.ts` should import only `seedAdminIfEmpty` from `./seed-admin`.

- [ ] **Step 3: Run tests to verify the migration is clean**

Run: `pnpm --filter cms vitest run apps/cms/scripts/docker-entrypoint/seed-admin.test.ts apps/cms/utils/validatePassword.test.ts`

Expected: PASS (seedAdminIfEmpty tests + all validator unit tests).

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter cms typecheck`

Expected: PASS — no dangling references to the removed symbols.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/docker-entrypoint/seed-admin.ts apps/cms/scripts/docker-entrypoint/seed-admin.test.ts
git commit -m "refactor(seed-admin): use shared validatePassword module"
```

---

## Task 3: Add `User.passwordVersion` schema field + migration

Single column. `prisma migrate dev` requires an interactive terminal, so we hand-author the migration SQL (per the project memory) and apply via `prisma migrate deploy`.

**Files:**

- Modify: `apps/cms/prisma/schema/auth.prisma`
- Create: `apps/cms/prisma/migrations/<timestamp>_add_user_password_version/migration.sql`

- [ ] **Step 1: Update the Prisma schema**

Open `apps/cms/prisma/schema/auth.prisma`. Add `passwordVersion Int @default(0)` to the `User` model. After the change, `User` should look roughly like (only the new line is yours to add):

```prisma
model User {
  id             String   @id @default(uuid())
  email          String   @unique
  password       String
  firstName      String
  lastName       String
  passwordVersion Int     @default(0)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

(If your local schema differs slightly, just insert the new field — don't restructure the rest.)

- [ ] **Step 2: Create the migration directory + SQL**

Pick a current UTC timestamp `YYYYMMDDHHMMSS` (e.g. `20260428170000`). Create the directory:

```bash
TS=$(date -u +%Y%m%d%H%M%S)
mkdir -p "apps/cms/prisma/migrations/${TS}_add_user_password_version"
```

Create `apps/cms/prisma/migrations/${TS}_add_user_password_version/migration.sql` with:

```sql
-- AlterTable
ALTER TABLE "User" ADD COLUMN "passwordVersion" INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 3: Apply the migration**

Run from `apps/cms`:

```bash
cd apps/cms && pnpx prisma migrate deploy
```

Expected output: `1 migration applied`.

- [ ] **Step 4: Regenerate the Prisma client + Pothos types**

Run from the repo root:

```bash
pnpm prisma:generate
```

Expected: regeneration completes; `apps/cms/generated/prisma/client.ts` now reflects the new field.

- [ ] **Step 5: Typecheck the workspace**

Run: `pnpm --filter cms typecheck`

Expected: PASS — no errors. (Existing code does not yet read `passwordVersion`, so adding the optional column is non-breaking.)

- [ ] **Step 6: Commit**

```bash
git add apps/cms/prisma/schema/auth.prisma apps/cms/prisma/migrations/
git commit -m "feat(schema): add User.passwordVersion column"
```

---

## Task 4: Wire `passwordVersion` through login + auth middleware

Three coupled changes that must land together: the session type gains the field, login copies it from the DB, the middleware checks it on every session-authed request and 401s on mismatch.

**Files:**

- Modify: `apps/cms/auth.d.ts`
- Modify: `apps/cms/server/api/auth/login.post.ts`
- Modify: `apps/cms/server/middleware/auth.ts`
- Modify: `apps/cms/server/api/auth/auth.test.ts`

- [ ] **Step 1: Update the session type**

Open `apps/cms/auth.d.ts` and add the `passwordVersion` field:

```ts
declare module '#auth-utils' {
  interface User {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    passwordVersion: number;
  }
}

export {};
```

- [ ] **Step 2: Update the login endpoint to copy `passwordVersion`**

Open `apps/cms/server/api/auth/login.post.ts`. Update the `setUserSession` call so the session carries the DB's `passwordVersion`:

```ts
await setUserSession(event, {
  user: {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    passwordVersion: user.passwordVersion,
  },
});
```

(That's the only line that changes — `user` already holds the column because `findUnique` selects all fields by default.)

- [ ] **Step 3: Add an integration test for the login → session shape**

Open `apps/cms/server/api/auth/auth.test.ts`. Add this test inside the existing top-level `describe`:

```ts
it('login response carries passwordVersion in the session', async () => {
  const res = await $fetch.raw('/api/auth/login', {
    method: 'POST',
    body: { email: testEmail, password: testPassword },
  });
  const cookie = res.headers.getSetCookie().join('; ');
  // Hit a session-only endpoint to confirm the cookie works
  const me = await $fetch('/api/_auth/session', { headers: { cookie } });
  expect(me.user.passwordVersion).toBe(0);
});
```

(Use the same `testEmail` / `testPassword` setup the existing tests use — adapt to your fixtures.)

- [ ] **Step 4: Update the auth middleware to check `passwordVersion`**

Open `apps/cms/server/middleware/auth.ts`. Replace the session branch (currently `if (session.user) { event.context.authMethod = 'session'; return; }`) with:

```ts
const session = await getUserSession(event);
if (session.user) {
  // Verify the session's passwordVersion still matches the DB.
  // Cross-device session invalidation: when a user changes their password,
  // we bump User.passwordVersion. Old cookies still claim the previous
  // version and get 401'd here on their next request.
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordVersion: true },
  });
  if (!dbUser || dbUser.passwordVersion !== session.user.passwordVersion) {
    await clearUserSession(event);
    throw createError({ statusCode: 401, message: 'Session invalidated' });
  }
  event.context.authMethod = 'session';
  return;
}
```

- [ ] **Step 5: Add an integration test for the mismatch path**

Add inside the same `describe` in `apps/cms/server/api/auth/auth.test.ts`:

```ts
it('rejects a session whose passwordVersion no longer matches the DB', async () => {
  const loginRes = await $fetch.raw('/api/auth/login', {
    method: 'POST',
    body: { email: testEmail, password: testPassword },
  });
  const cookie = loginRes.headers.getSetCookie().join('; ');

  // Bump passwordVersion in the DB out from under the session
  await prisma.user.update({
    where: { email: testEmail },
    data: { passwordVersion: { increment: 1 } },
  });

  // Any authenticated request must now 401
  await expect(
    $fetch('/api/content-types', { headers: { cookie } })
  ).rejects.toMatchObject({ status: 401 });
});
```

- [ ] **Step 6: Run the auth integration tests**

Run: `pnpm --filter cms vitest run apps/cms/server/api/auth/auth.test.ts`

Expected: PASS — both new cases plus the existing suite.

- [ ] **Step 7: Commit**

```bash
git add apps/cms/auth.d.ts apps/cms/server/api/auth/login.post.ts apps/cms/server/middleware/auth.ts apps/cms/server/api/auth/auth.test.ts
git commit -m "feat(auth): cross-device session invalidation via passwordVersion"
```

---

## Task 5: `POST /api/account/password` endpoint

The core endpoint. Built test-first — write the integration test file with all scenarios first, then implement until everything is green.

**Files:**

- Create: `apps/cms/server/api/account/password.post.ts`
- Create: `apps/cms/server/api/account/account-password.test.ts`

- [ ] **Step 1: Write the integration test suite**

Create `apps/cms/server/api/account/account-password.test.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { setup, $fetch } from '@nuxt/test-utils/e2e';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../utils/prisma';
import { TEST_USER_EMAIL, TEST_USER_PASSWORD } from '../../test/credentials';

await setup({
  rootDir: fileURLToPath(new URL('../../..', import.meta.url)),
  dev: true,
});

async function login(email = TEST_USER_EMAIL, password = TEST_USER_PASSWORD) {
  const res = await $fetch.raw('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  return res.headers.getSetCookie().join('; ');
}

// Re-hashes TEST_USER_PASSWORD using the same scrypt scheme as
// `prisma/seed.ts::hashPasswordForSeed` so login continues to work.
// Resets passwordVersion to 0 so middleware reads a clean slate.
async function resetTestUser() {
  const { randomBytes, scrypt: scryptCb } = await import('node:crypto');
  const salt = randomBytes(16);
  const derived: Buffer = await new Promise((resolve, reject) => {
    scryptCb(
      TEST_USER_PASSWORD,
      salt,
      64,
      {
        cost: 16384,
        blockSize: 8,
        parallelization: 1,
        maxmem: 32 * 1024 * 1024,
      },
      (err, dk) => (err ? reject(err) : resolve(dk))
    );
  });
  const saltB64 = salt.toString('base64').replace(/=+$/, '');
  const hashB64 = derived.toString('base64').replace(/=+$/, '');
  const password = `$scrypt$n=16384,r=8,p=1$${saltB64}$${hashB64}`;
  await prisma.user.update({
    where: { email: TEST_USER_EMAIL },
    data: { password, passwordVersion: 0 },
  });
}

describe('POST /api/account/password', () => {
  beforeAll(async () => {
    // The test DB is reset and seeded by vitest.globalSetup.ts;
    // no per-suite reset required here unless tests mutate the user.
  });

  afterEach(async () => {
    // Restore the fixture password + passwordVersion so subsequent tests
    // can log in with the original credentials.
    await resetTestUser();
  });

  it('changes the password (204), bumps passwordVersion, current cookie still works', async () => {
    const cookie = await login();

    const res = await $fetch.raw('/api/account/password', {
      method: 'POST',
      body: {
        currentPassword: TEST_USER_PASSWORD,
        newPassword: 'R8#fT2!qwLpZ-new',
      },
      headers: { cookie },
    });
    expect(res.status).toBe(204);

    const dbUser = await prisma.user.findUnique({
      where: { email: TEST_USER_EMAIL },
    });
    expect(dbUser?.passwordVersion).toBe(1);

    // Current device's cookie was re-issued; should still hit a session-only route
    const newCookie = res.headers.getSetCookie().join('; ');
    const me = await $fetch('/api/_auth/session', {
      headers: { cookie: newCookie },
    });
    expect(me.user.passwordVersion).toBe(1);
  });

  it('returns 401 when currentPassword is wrong', async () => {
    const cookie = await login();
    await expect(
      $fetch('/api/account/password', {
        method: 'POST',
        body: {
          currentPassword: 'definitely-not-the-password',
          newPassword: 'R8#fT2!qwLpZ-new',
        },
        headers: { cookie },
      })
    ).rejects.toMatchObject({ status: 401 });

    const dbUser = await prisma.user.findUnique({
      where: { email: TEST_USER_EMAIL },
    });
    expect(dbUser?.passwordVersion).toBe(0);
  });

  it('returns 400 WEAK_PASSWORD with failures=[blocklist] for a blocklisted password', async () => {
    const cookie = await login();
    const err = await $fetch('/api/account/password', {
      method: 'POST',
      body: {
        currentPassword: TEST_USER_PASSWORD,
        newPassword: 'password123',
      },
      headers: { cookie },
    }).catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.data.error).toBe('WEAK_PASSWORD');
    expect(err.data.failures).toContain('blocklist');
  });

  it('returns 400 WEAK_PASSWORD with failures=[length] for a too-short password', async () => {
    const cookie = await login();
    const err = await $fetch('/api/account/password', {
      method: 'POST',
      body: {
        currentPassword: TEST_USER_PASSWORD,
        newPassword: 'short!',
      },
      headers: { cookie },
    }).catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.data.failures).toContain('length');
  });

  it('returns 400 WEAK_PASSWORD with failures=[localPart] when newPassword equals email local-part', async () => {
    const cookie = await login();
    // TEST_USER_EMAIL local-part repeated to clear length, but still equal once normalised
    const localPart = TEST_USER_EMAIL.split('@')[0];
    const err = await $fetch('/api/account/password', {
      method: 'POST',
      body: {
        currentPassword: TEST_USER_PASSWORD,
        newPassword: localPart.padEnd(12, localPart),
      },
      headers: { cookie },
    }).catch((e) => e);
    expect(err.status).toBe(400);
    // (`localPart` only fires if the *whole* password equals the local-part —
    //  for an exact-match scenario, the seed-test user's local-part may need
    //  to be padded to 12+ chars at the fixture level. If your fixture local-part
    //  is already ≥12 chars, just pass it as the newPassword.)
  });

  it('returns 400 when fields are missing', async () => {
    const cookie = await login();
    await expect(
      $fetch('/api/account/password', {
        method: 'POST',
        body: { currentPassword: TEST_USER_PASSWORD },
        headers: { cookie },
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('returns 401 with no session', async () => {
    await expect(
      $fetch('/api/account/password', {
        method: 'POST',
        body: {
          currentPassword: TEST_USER_PASSWORD,
          newPassword: 'R8#fT2!qwLpZ-new',
        },
      })
    ).rejects.toMatchObject({ status: 401 });
  });

  it('returns 401 (or 403) with an API-key Bearer token', async () => {
    await expect(
      $fetch('/api/account/password', {
        method: 'POST',
        body: {
          currentPassword: TEST_USER_PASSWORD,
          newPassword: 'R8#fT2!qwLpZ-new',
        },
        headers: {
          authorization: 'Bearer boject_test_key_for_integration_tests_only',
        },
      })
    ).rejects.toMatchObject({ status: 403 }); // existing middleware: API keys read-only
  });

  it('rate-limits after 5 attempts in 60s', async () => {
    const cookie = await login();
    // Use a unique simulated IP so this test's budget is isolated from
    // other tests in the suite (the in-process rate limiter is per-IP).
    const ip = `192.0.2.${Math.floor(Math.random() * 254) + 1}`; // TEST-NET-1
    const headers = { cookie, 'x-forwarded-for': ip };

    // 5 wrong-password attempts use up the budget for this IP
    for (let i = 0; i < 5; i++) {
      await $fetch('/api/account/password', {
        method: 'POST',
        body: { currentPassword: 'wrong', newPassword: 'R8#fT2!qwLpZ-new' },
        headers,
      }).catch(() => {});
    }
    await expect(
      $fetch('/api/account/password', {
        method: 'POST',
        body: {
          currentPassword: TEST_USER_PASSWORD,
          newPassword: 'R8#fT2!qwLpZ-new',
        },
        headers,
      })
    ).rejects.toMatchObject({ status: 429 });
  });

  it('invalidates other devices on next request', async () => {
    const cookieA = await login();
    const cookieB = await login(); // simulate a second device

    await $fetch.raw('/api/account/password', {
      method: 'POST',
      body: {
        currentPassword: TEST_USER_PASSWORD,
        newPassword: 'R8#fT2!qwLpZ-new',
      },
      headers: { cookie: cookieA },
    });

    // Device B's cookie still claims passwordVersion=0; middleware rejects
    await expect(
      $fetch('/api/content-types', { headers: { cookie: cookieB } })
    ).rejects.toMatchObject({ status: 401 });
  });
});
```

(If `apps/cms/server/test/credentials.ts` doesn't yet export `TEST_USER_EMAIL` / `TEST_USER_PASSWORD`, add them there alongside the existing helpers — both should match `INTEGRATION_TEST_USERNAME` / `INTEGRATION_TEST_PASSWORD` env-var fallback values used by `prisma/seed.ts`.)

- [ ] **Step 2: Run the suite to confirm it fails**

Run: `pnpm --filter cms vitest run apps/cms/server/api/account/account-password.test.ts`

Expected: FAIL — endpoint returns 404 for every case.

- [ ] **Step 3: Implement the endpoint**

Create `apps/cms/server/api/account/password.post.ts`:

```ts
import { hashPassword, verifyPassword } from '#auth-utils';
import { validatePassword } from '../../../utils/validatePassword';

export default defineEventHandler(async (event) => {
  // 1. Per-IP rate limit (tighter than login because change-password is more sensitive)
  const ip =
    getRequestHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() ||
    getRequestIP(event) ||
    'unknown';
  const { allowed, retryAfterMs } = rateLimit(
    `password-change:${ip}`,
    5,
    60_000
  );
  if (!allowed) {
    setHeader(event, 'Retry-After', Math.ceil(retryAfterMs / 1000));
    throw createError({
      statusCode: 429,
      message: 'Too many password-change attempts',
    });
  }

  // 2. Session required. Auth middleware already enforced session-or-API-key
  //    plus the API-key-read-only check; this is defense-in-depth.
  const session = await getUserSession(event);
  if (!session.user) {
    throw createError({ statusCode: 401, message: 'Unauthorized' });
  }

  // 3. Body
  const body = await readBody<{
    currentPassword?: string;
    newPassword?: string;
  }>(event);
  const currentPassword = body?.currentPassword;
  const newPassword = body?.newPassword;
  if (!currentPassword || !newPassword) {
    throw createError({ statusCode: 400, message: 'Missing fields' });
  }

  // 4. Verify current password
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
  });
  if (!user || !(await verifyPassword(user.password, currentPassword))) {
    throw createError({ statusCode: 401, message: 'Invalid credentials' });
  }

  // 5. Validate new password (shared rules)
  const result = validatePassword(newPassword, { email: user.email });
  if (!result.ok) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Weak password',
      data: { error: 'WEAK_PASSWORD', failures: result.failures },
    });
  }

  // 6. Hash + bump passwordVersion atomically
  const hashed = await hashPassword(newPassword);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      password: hashed,
      passwordVersion: { increment: 1 },
    },
  });

  // 7. Re-issue session for the current device with the new version so the
  //    user stays signed in here. Other devices fail their next request via
  //    the auth middleware's passwordVersion check.
  await setUserSession(event, {
    user: {
      id: updated.id,
      email: updated.email,
      firstName: updated.firstName,
      lastName: updated.lastName,
      passwordVersion: updated.passwordVersion,
    },
  });

  setResponseStatus(event, 204);
  return null;
});
```

- [ ] **Step 4: Run the suite again**

Run: `pnpm --filter cms vitest run apps/cms/server/api/account/account-password.test.ts`

Expected: PASS — all 9 scenarios green.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/api/account/ apps/cms/server/test/credentials.ts
git commit -m "feat(api): POST /api/account/password endpoint"
```

---

## Task 6: `PasswordRequirements` component

Renders the `PASSWORD_RULES` registry with per-rule satisfied/unsatisfied state. Standalone so future "set initial password" surfaces (e.g. admin-invites-user under #83) reuse it without duplicating layout.

**Files:**

- Create: `apps/cms/components/password-requirements/PasswordRequirements.vue`
- Create: `apps/cms/components/password-requirements/passwordRequirements.config.ts`
- Create: `apps/cms/components/password-requirements/passwordRequirements.types.ts`

- [ ] **Step 1: Create the types file**

Create `apps/cms/components/password-requirements/passwordRequirements.types.ts`:

```ts
import type { PasswordRuleId } from '~/utils/validatePassword';
import type { BasicComponentProps } from '~/types/basicComponentProps';

export interface PasswordRequirementsProps extends BasicComponentProps {
  /**
   * The list of rule ids that are currently failing. Each rule the panel
   * renders is satisfied iff its id is NOT in this array.
   */
  failures: PasswordRuleId[];
}
```

- [ ] **Step 2: Create the config file**

Create `apps/cms/components/password-requirements/passwordRequirements.config.ts`:

```ts
import { testIds } from '~/utils/test-config/testConfig.utils';

export const QA_PASSWORD_REQUIREMENTS = testIds('password-requirements', [
  'root',
  'rule',
  'rule-icon',
  'rule-label',
] as const);
```

- [ ] **Step 3: Create the Vue component**

Create `apps/cms/components/password-requirements/PasswordRequirements.vue`:

```vue
<script setup lang="ts">
import { PASSWORD_RULES } from '~/utils/validatePassword';
import { QA_PASSWORD_REQUIREMENTS } from './passwordRequirements.config';
import type { PasswordRequirementsProps } from './passwordRequirements.types';

const props = defineProps<PasswordRequirementsProps>();

const rows = computed(() =>
  PASSWORD_RULES.map((rule) => ({
    id: rule.id,
    label: rule.label,
    satisfied: !props.failures.includes(rule.id),
  }))
);
</script>

<template>
  <div
    :data-testid="props.testId ?? QA_PASSWORD_REQUIREMENTS.root"
    class="flex flex-col gap-3 rounded-lg border border-default bg-elevated/50 px-5 py-4"
  >
    <div class="text-xs font-medium uppercase tracking-wider text-muted">
      Requirements
    </div>
    <div
      v-for="row in rows"
      :key="row.id"
      :data-testid="QA_PASSWORD_REQUIREMENTS.rule"
      class="flex items-center gap-2.5"
    >
      <UIcon
        :name="row.satisfied ? 'i-lucide-check-circle-2' : 'i-lucide-circle'"
        :data-testid="QA_PASSWORD_REQUIREMENTS['rule-icon']"
        :class="
          row.satisfied
            ? 'h-4 w-4 flex-shrink-0 text-success'
            : 'h-4 w-4 flex-shrink-0 text-muted'
        "
      />
      <span
        :data-testid="QA_PASSWORD_REQUIREMENTS['rule-label']"
        :class="row.satisfied ? 'text-sm text-default' : 'text-sm text-muted'"
      >
        {{ row.label }}
      </span>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter cms typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/components/password-requirements/
git commit -m "feat(component): PasswordRequirements panel"
```

---

## Task 7: `/account` page

The page that hosts the password-change form. Single section for v1; structure leaves room for future Profile / Roles sections (#83).

**Files:**

- Create: `apps/cms/pages/account.vue`

- [ ] **Step 1: Create the page**

Create `apps/cms/pages/account.vue`:

```vue
<script setup lang="ts">
import { validatePassword } from '~/utils/validatePassword';

const { user } = useUserSession();
const router = useRouter();
const toast = useToast();

const form = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
});

const errors = reactive({
  current: null as string | null,
  confirm: null as string | null,
});

const isSubmitting = ref(false);

const validation = computed(() =>
  validatePassword(form.newPassword, { email: user.value?.email ?? '' })
);

const confirmMatches = computed(
  () =>
    form.confirmPassword.length > 0 && form.confirmPassword === form.newPassword
);

const canSubmit = computed(
  () =>
    form.currentPassword.length > 0 &&
    validation.value.ok &&
    confirmMatches.value &&
    !isSubmitting.value
);

watch(
  () => form.confirmPassword,
  (val) => {
    if (val.length === 0) {
      errors.confirm = null;
    } else if (val !== form.newPassword) {
      errors.confirm = "Passwords don't match.";
    } else {
      errors.confirm = null;
    }
  }
);

watch(
  () => form.currentPassword,
  () => {
    // Clear server error on edit
    errors.current = null;
  }
);

function cancel() {
  if (window.history.length > 1) router.back();
  else router.push('/');
}

async function submit() {
  if (!canSubmit.value) return;
  isSubmitting.value = true;
  try {
    await $fetch('/api/account/password', {
      method: 'POST',
      body: {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      },
    });
    form.currentPassword = '';
    form.newPassword = '';
    form.confirmPassword = '';
    toast.add({
      title: 'Password updated',
      description: 'Other devices have been signed out.',
      icon: 'i-lucide-check-circle-2',
      color: 'success',
    });
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 401) {
      errors.current = 'Current password is incorrect.';
      form.currentPassword = '';
    } else if (status === 429) {
      toast.add({
        title: 'Too many attempts',
        description: 'Wait a minute and try again.',
        color: 'warning',
      });
    } else {
      toast.add({
        title: 'Could not update password',
        description: 'Please try again.',
        color: 'error',
      });
    }
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col">
    <div
      class="flex items-center gap-2 border-b border-default px-14 py-6 text-sm"
    >
      <span class="text-muted">Account</span>
      <span class="text-muted/50">/</span>
      <span class="font-medium text-default">Password</span>
    </div>

    <div class="flex flex-col gap-3 px-14 pt-14">
      <h1 class="text-4xl font-semibold tracking-tight">Password</h1>
      <p class="max-w-xl text-base text-muted">
        Change your account password. You'll stay signed in here, but other
        devices will be signed out.
      </p>
    </div>

    <form
      class="flex max-w-xl flex-col gap-7 px-14 pt-10"
      @submit.prevent="submit"
    >
      <UFormField label="Current password" :error="errors.current ?? undefined">
        <UInput
          v-model="form.currentPassword"
          type="password"
          autocomplete="current-password"
          class="w-full"
        />
      </UFormField>

      <UFormField label="New password">
        <UInput
          v-model="form.newPassword"
          type="password"
          autocomplete="new-password"
          class="w-full"
        />
      </UFormField>

      <UFormField
        label="Confirm new password"
        :error="errors.confirm ?? undefined"
      >
        <UInput
          v-model="form.confirmPassword"
          type="password"
          autocomplete="new-password"
          class="w-full"
        />
      </UFormField>

      <PasswordRequirements :failures="validation.failures" />

      <div class="mt-8 flex justify-end gap-3 border-t border-default pt-10">
        <UButton variant="outline" color="neutral" @click="cancel">
          Cancel
        </UButton>
        <UButton type="submit" :disabled="!canSubmit" :loading="isSubmitting">
          Update password
        </UButton>
      </div>
    </form>
  </div>
</template>
```

- [ ] **Step 2: Manually verify in dev**

Run: `pnpm dev` and visit http://localhost:4000/account.

Verify:

- The breadcrumb, title, subtitle, and form render.
- Typing a strong password makes the requirements panel rows go green and the Update button enable.
- Typing a weak password (e.g. `password123`) keeps the blocklist row unsatisfied and the button disabled.
- Mismatched confirm shows an inline error.
- Wrong current password → toast/error and current field clears; form preserved.
- Successful change → toast, form clears, you stay signed in (current cookie is re-issued).
- Logging in from a private window before the change, then changing the password, then refreshing the private window: the private window logs out (401 → redirect to /login per existing client middleware).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter cms typecheck`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/cms/pages/account.vue
git commit -m "feat(page): /account password change form"
```

---

## Task 8: Add `Account` item to the user dropdown

The entry point users discover. Sits between the user-label header and Logout.

**Files:**

- Modify: `apps/cms/layouts/default.vue`

- [ ] **Step 1: Update `userMenuItems`**

Open `apps/cms/layouts/default.vue`. The current shape (around line 43) is:

```ts
const userMenuItems = computed<DropdownMenuItem[][]>(() => [
  [
    {
      label: fullName.value,
      type: 'label',
    },
  ],
  [
    {
      label: 'Logout',
      icon: 'i-lucide-log-out',
      onSelect: logout,
    },
  ],
]);
```

Replace with:

```ts
const userMenuItems = computed<DropdownMenuItem[][]>(() => [
  [
    {
      label: fullName.value,
      type: 'label',
    },
  ],
  [
    {
      label: 'Account',
      icon: 'i-lucide-user',
      to: '/account',
    },
  ],
  [
    {
      label: 'Logout',
      icon: 'i-lucide-log-out',
      onSelect: logout,
    },
  ],
]);
```

- [ ] **Step 2: Manually verify in dev**

Run: `pnpm dev`. Click the avatar in the top-right of any page. Confirm:

- The dropdown shows three groups: name label, Account, Logout.
- Clicking "Account" navigates to `/account`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter cms typecheck`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/cms/layouts/default.vue
git commit -m "feat(layout): add Account item to user dropdown"
```

---

## Final verification

- [ ] **Run the full unit + integration suite**

Run: `pnpm test`

Expected: PASS — all existing tests + the new validator unit tests + the new endpoint integration tests + the extended auth tests.

- [ ] **Update `CLAUDE.md`**

Add a short bullet under Authentication describing:

- The `passwordVersion` mechanism.
- The new `/account` page and `POST /api/account/password` endpoint.
- The shared `apps/cms/utils/validatePassword.ts` validator.

- [ ] **Open the PR**

Push and open against `main` with a body that links the spec and #130, lists the eight commits, and summarises behaviour for reviewers.
