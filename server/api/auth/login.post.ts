export default defineEventHandler(async (event) => {
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
    user: { id: user.id, email: user.email, name: user.name },
  });

  return { ok: true };
});
