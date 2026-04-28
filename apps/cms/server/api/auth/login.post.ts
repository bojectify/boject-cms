export default defineEventHandler(async (event) => {
  // Rate limit login attempts by IP
  const ip =
    getRequestHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() ||
    getRequestIP(event) ||
    'unknown';
  const { allowed, retryAfterMs } = rateLimit(`login:${ip}`, 10, 60_000);
  if (!allowed) {
    setHeader(event, 'Retry-After', Math.ceil(retryAfterMs / 1000));
    throw createError({
      statusCode: 429,
      message: 'Too many login attempts',
    });
  }

  const { email, password } = await readBody<{
    email: string;
    password: string;
  }>(event);

  if (!email || !password) {
    throw createError({ statusCode: 400, message: 'Missing credentials' });
  }

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !(await verifyPassword(user.password, password))) {
    throw createError({ statusCode: 401, message: 'Invalid credentials' });
  }

  await setUserSession(event, {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      passwordVersion: user.passwordVersion,
    },
  });

  return { ok: true };
});
