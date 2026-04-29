// Cross-device session invalidation: when a user changes their password on
// another device, this device's next /api/* request returns 401 from the
// server auth middleware. Without this interceptor, the page sits with no
// data because nothing wires the 401 back to a navigation.
export default defineNuxtPlugin(() => {
  const { clear, loggedIn } = useUserSession();

  globalThis.$fetch = $fetch.create({
    async onResponseError({ request, response }) {
      if (response.status !== 401) return;

      const url =
        typeof request === 'string'
          ? request
          : request instanceof URL
            ? request.href
            : request.url;
      if (!url.includes('/api/') || url.includes('/api/auth/')) return;

      if (loggedIn.value) await clear();
      await navigateTo('/login');
    },
  });
});
