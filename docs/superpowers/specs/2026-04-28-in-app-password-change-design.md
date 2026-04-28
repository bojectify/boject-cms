# In-app password change

**Status:** Draft · **Date:** 2026-04-28 · **Tracks:** [#130](https://github.com/ness-EE/boject-cms/issues/130) · **Adjacent:** [#83](https://github.com/ness-EE/boject-cms/issues/83)

## Problem

Whatever password is written at first boot — by the scaffolder (`packages/create-boject-cms/src/secrets.ts`) or by an operator-supplied `BOJECT_ADMIN_PASSWORD` (`apps/cms/scripts/docker-entrypoint/seed-admin.ts`) — is the credential indefinitely. The only way to rotate is direct SQL. This is the chronic gap behind the recently-shipped seed-time validator.

## Goals

- Logged-in user changes their own password from the CMS UI.
- Strength validation is the same shared rule set used by the first-boot seed.
- Existing sessions on other devices are invalidated. The current device's session is re-issued so the user stays signed in here.
- Endpoint is rate-limited and CSRF-protected, consistent with the rest of `/api/`.
- Forward-compatible with #83: when roles ship, every role (Admin / Developer / Editor) uses this same flow unchanged.

## Non-goals

- Password reset for forgotten passwords (needs email infra; tracked separately).
- Admin-resets-another-user's-password (lives under user management, owned by #83).
- Changing email, name, or any other profile field (page leaves room, but v1 is password-only).
- Notifying the user via email when their password changes.
- Per-user lockout after N wrong currentPassword attempts (per-IP rate limit only for v1).

## UX

### Entry point: user dropdown menu

`apps/cms/layouts/default.vue` already renders a dropdown anchored on the avatar. The current `userMenuItems` shape is:

```
[ [{ label: fullName, type: 'label' }],
  [{ label: 'Logout', icon: 'i-lucide-log-out', onSelect: logout }] ]
```

Add a middle group with one item:

```
[ { label: 'Account', icon: 'i-lucide-user', to: '/account' } ]
```

Clicking navigates to `/account`. No modal.

### `/account` page

Single-purpose for v1: a "Password" section. Page chrome matches the existing form-page pattern (see Webhooks → New for reference).

Structure:

- Breadcrumb top: `Account` (muted) `/` `Password` (active).
- Page header: H1 "Password" (Inter 40px / 600 / -0.02em) and a one-line subtitle: _"Change your account password. You'll stay signed in here, but other devices will be signed out."_
- Form column, max-width ~640px:
  - **Current password** (label, then password input)
  - **New password**
  - **Confirm new password**
  - Requirements panel (see below)
- Action row at bottom (border-top, right-aligned): `Cancel` (outline; `useRouter().back()` — falls back to `/` if no history) and `Update password` (primary cobalt).

### Requirements panel (live feedback)

Subtle off-white card directly below the confirm field. Header `REQUIREMENTS` (small caps, 13px, muted). Three rows, each with a circular check icon and label. As the user types in **New password**, each row's check turns green (`#16a34a`) when its rule passes. Until all three pass, the **Update password** button is disabled.

The three rules (driven by the shared `PASSWORD_RULES` registry, see Validator section):

| id          | label                                       | rule                                                            |
| ----------- | ------------------------------------------- | --------------------------------------------------------------- |
| `length`    | At least 12 characters                      | `password.length >= 12`                                         |
| `blocklist` | Not on the common-password blocklist        | `!WEAK_PASSWORD_BLOCKLIST.has(password.toLowerCase())`          |
| `localPart` | Different from the local-part of your email | `password.toLowerCase() !== email.split('@')[0]?.toLowerCase()` |

The blocklist (~13 strings) is small enough to ship to the client without concern.

### Inline error states

- **Confirm doesn't match** — local check; show a red message under the Confirm field after blur. Submit blocked.
- **Current password wrong** — server-only; on 401, show a red message under the Current field: _"Current password is incorrect."_. Field clears, others retained.
- **Server validation rejection** (defense-in-depth — should never fire with client validation gating submit) — show the rule labels for the failing ids under the New password field.

### Success state

- Toast: _"Password updated. Other devices have been signed out."_
- Stay on `/account`. Form resets to empty fields.

### Mockups

Paper file `Scratchpad`:

- Artboard "Account — Password" (960px × fit-content)
- Artboard "User Dropdown — with Account"

## Architecture

### Endpoint

`POST /api/account/password`

```ts
// Request
{ currentPassword: string; newPassword: string }

// Responses
204 No Content                                              // success
401 Unauthorized        { message: 'Invalid credentials' }  // wrong currentPassword
400 Bad Request         { error: 'WEAK_PASSWORD', failures: PasswordRuleId[] }
400 Bad Request         { message: 'Missing fields' }
429 Too Many Requests                                       // rate limit
```

Pseudocode:

```ts
export default defineEventHandler(async (event) => {
  // 1. Rate limit per IP
  const ip = getClientIp(event);
  const { allowed } = rateLimit(`password-change:${ip}`, 5, 60_000);
  if (!allowed) throw createError({ statusCode: 429, ... });

  // 2. Session required (auth middleware already enforced session-only;
  //    here we just read it)
  const session = await getUserSession(event);
  if (!session.user) throw createError({ statusCode: 401, ... });

  // 3. Read body
  const { currentPassword, newPassword } = await readBody(event);
  if (!currentPassword || !newPassword) throw createError({ statusCode: 400, ... });

  // 4. Verify current password
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user || !(await verifyPassword(user.password, currentPassword))) {
    throw createError({ statusCode: 401, message: 'Invalid credentials' });
  }

  // 5. Validate new password (shared validator)
  const result = validatePassword(newPassword, { email: user.email });
  if (!result.ok) {
    throw createError({
      statusCode: 400,
      data: { error: 'WEAK_PASSWORD', failures: result.failures },
    });
  }

  // 6. Hash + bump passwordVersion in one transaction
  const hashed = await hashPassword(newPassword);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { password: hashed, passwordVersion: { increment: 1 } },
  });

  // 7. Re-issue session for current device with new version
  await setUserSession(event, {
    user: {
      id: updated.id,
      email: updated.email,
      firstName: updated.firstName,
      lastName: updated.lastName,
      passwordVersion: updated.passwordVersion,
    },
  });

  return null; // 204
});
```

### Data model

Add one column to `User` (`apps/cms/prisma/schema/auth.prisma`):

```prisma
model User {
  // ... existing fields
  passwordVersion Int @default(0)
}
```

Migration is a single `ALTER TABLE` adding the column with default 0; existing rows are auto-populated.

Session shape (`apps/cms/auth.d.ts`) gains `passwordVersion: number`:

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
```

The login endpoint (`apps/cms/server/api/auth/login.post.ts`) is updated to copy `user.passwordVersion` into the session. Existing logins without the field would fail; sessions issued before this ships are invalidated on first request after deployment (acceptable — single user today, short outage of "log in again once" cost).

### Session invalidation in middleware

`apps/cms/server/middleware/auth.ts` adds a check on the session-auth branch:

```ts
const session = await getUserSession(event);
if (session.user) {
  // Verify session's passwordVersion still matches the DB.
  // One Prisma read per CMS-authed request — same shape as the API-key path.
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

This adds one DB roundtrip per session-authed `/api/*` request. Acceptable: the CMS user surface is a small number of human admins, the existing API-key validation already does a DB lookup, and the auth middleware is already touching the DB shape.

### Validator (shared client + server module)

New file `apps/cms/utils/validatePassword.ts` (NOT `server/utils/`, because the client also needs it). The file has zero Nuxt-specific imports.

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

`apps/cms/scripts/docker-entrypoint/seed-admin.ts` is updated:

- Removes the local `validateAdminPassword` and blocklist (deduplicate).
- Imports `validatePassword`, `PASSWORD_RULES` from `../../utils/validatePassword.ts` (relative path; works under `tsx`).
- On failure, joins rule labels into the existing string-message contract:
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

The existing `seed-admin.test.ts` is updated to import from the new module. Behaviour is preserved.

### Rate limiting and CSRF

- Per-IP: `rateLimit('password-change:${ip}', 5, 60_000)` using the existing `apps/cms/server/utils/rateLimit.ts`.
- CSRF: covered by the existing `apps/cms/server/middleware/csrf.ts` (origin/referer check on non-GET `/api/*`). No code change.
- The endpoint is mounted at `/api/account/password`, so the auth middleware **does** protect it (it's not in the auth-skip list).

## UI implementation

### Page

`apps/cms/pages/account.vue` — new file. Single-section page for v1; section is the password form.

```vue
<script setup lang="ts">
const { user } = useUserSession();

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
  () => form.confirmPassword === form.newPassword
);

const canSubmit = computed(
  () =>
    form.currentPassword.length > 0 &&
    validation.value.ok &&
    confirmMatches.value &&
    !isSubmitting.value
);

async function submit() {
  /* POST /api/account/password, handle 401/400/204 */
}
</script>
```

### Components

- `apps/cms/components/password-requirements/PasswordRequirements.vue` — renders the `PASSWORD_RULES` registry, takes `failures: PasswordRuleId[]` and renders each rule with a satisfied/unsatisfied check icon.
  - Standalone component so other surfaces (e.g. future "set initial password" flow when an admin invites a user, role of #83) can reuse it without duplicating the layout.
- The form fields themselves use Nuxt UI's `UInput type="password"`.

### Dropdown menu update

`apps/cms/layouts/default.vue` — `userMenuItems` gains the middle group as described in UX.

## Tests

### Unit

`apps/cms/utils/validatePassword.test.ts` — replaces the existing `seed-admin.test.ts` validator coverage. Tests:

- Strong password passes (`{ ok: true, failures: [] }`).
- Length-failed password returns `{ failures: ['length'] }`.
- Blocklisted password returns `{ failures: ['blocklist'] }` (case-insensitive across uppercase variations).
- Email local-part match returns `{ failures: ['localPart'] }`.
- Multiple-failure case returns all failure ids.

`apps/cms/scripts/docker-entrypoint/seed-admin.test.ts` keeps testing the seed-admin CLI's integration with the validator (validator's behaviour is now covered by its own unit tests; seed-admin tests just verify it correctly errors on validator rejection).

### Integration

`apps/cms/server/api/auth/account-password.test.ts` (new). Boots the dev Nitro server, creates a session via login, then exercises:

| Scenario                            | Expected                                                                                                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Successful change                   | 204; `passwordVersion` bumped on the row; current cookie continues to work for the next request; old hash no longer accepted by login                                |
| Wrong currentPassword               | 401; `passwordVersion` unchanged; old password still works for login                                                                                                 |
| Weak newPassword (`password123`)    | 400 with `{ error: 'WEAK_PASSWORD', failures: ['blocklist'] }`; row unchanged                                                                                        |
| newPassword equals email local-part | 400 with `failures: ['localPart']`                                                                                                                                   |
| newPassword too short (`short!`)    | 400 with `failures: ['length']`                                                                                                                                      |
| Missing field (no currentPassword)  | 400                                                                                                                                                                  |
| No session                          | 401 (auth middleware rejects)                                                                                                                                        |
| API-key Bearer token                | 401 (the endpoint requires `authMethod === 'session'`)                                                                                                               |
| Rate limit (>5 attempts in 60s)     | 429                                                                                                                                                                  |
| Other-device session invalidation   | After successful change, a second cookie issued from an earlier login fails on its next `/api/*` request with 401 (middleware rejects on `passwordVersion` mismatch) |

`apps/cms/server/middleware/auth.test.ts` (extends existing) — covers the new `passwordVersion` mismatch branch.

## Migration

Single Prisma migration:

```sql
ALTER TABLE "User" ADD COLUMN "passwordVersion" INTEGER NOT NULL DEFAULT 0;
```

No backfill needed — `DEFAULT 0` covers all existing rows.

Existing user sessions issued before this ships will fail their next request because their session has no `passwordVersion`, and the middleware compares against DB `0`. The check is `session.user.passwordVersion !== dbUser.passwordVersion`; an undefined session field strict-not-equals `0`, so they're invalidated. Acceptable: any user logged in at deploy time gets a single 401 and re-auths.

## Acceptance criteria

Mirroring [#130](https://github.com/ness-EE/boject-cms/issues/130):

- [ ] Logged-in user can change their own password from the CMS UI.
- [ ] Password change requires the current password to be entered.
- [ ] New password is run through the same strength validation as the first-boot seed (shared module).
- [ ] Existing sessions on other devices are invalidated after a successful change. The current device stays signed in.
- [ ] Endpoint is rate-limited (5/60s per IP) and CSRF-protected.
- [ ] Integration tests cover: success, wrong current password, each weak-password failure mode, session invalidation across devices.

## Open questions

None — all decisions settled during brainstorming.

## Related

- Issue #130 — the originating ticket.
- Issue #83 — role-based authorisation; the password-change flow as designed is role-agnostic and ships unchanged when roles arrive. Admin-resets-other-user is owned by #83.
- PR #131 — `harden(seed-admin): validate admin password strength` (the first-boot validator this design extracts and shares).
