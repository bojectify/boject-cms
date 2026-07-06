import { validatePassword } from '../../../utils/validatePassword';
import { getClientIp } from '../../utils/clientIp';

export default defineEventHandler(async (event) => {
  // 1. Per-IP rate limit (tighter than login because change-password is more sensitive)
  const ip = getClientIp(event);
  const { allowed, retryAfterMs } = rateLimit(
    `password-change:${ip}`,
    5,
    60_000
  );
  if (!allowed) {
    throwRateLimited(event, 'password', retryAfterMs);
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
