/**
 * Wrapper around `useFetch` that forwards the incoming request's `cookie`
 * header when running on the server during SSR. Without this, server-side
 * fetches hit the auth middleware without a session and receive 401, causing
 * hydration mismatches once the client re-fetches with the cookie.
 *
 * Use for every call to an authenticated `/api/*` endpoint.
 *
 * Signature mirrors `useFetch` exactly — pass the same args you would to `useFetch`.
 */
export const useAuthedFetch: typeof useFetch = (url, options) => {
  const headers = useRequestHeaders(['cookie']);
  return useFetch(url, {
    ...options,
    headers: {
      ...headers,
      ...((options as { headers?: Record<string, string> })?.headers ?? {}),
    },
  } as Parameters<typeof useFetch>[1]);
};
