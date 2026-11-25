import { renderGraphiQL } from 'graphql-yoga';

/**
 * GraphiQL on a running image (#525), opted into with BOJECT_GRAPHIQL=true.
 *
 * Read from `process.env` per request, not at module scope: the bundler
 * inlines `process.env.NODE_ENV` when the image is BUILT, which is why the
 * NODE_ENV-gated dev GraphiQL is always off in the published image.
 *
 * Only the static page is served without a key. The handler renders it
 * itself rather than handing the request to Yoga (Yoga executes a GET
 * `?query=` whenever its own `graphiql` option is off), so every operation
 * GraphiQL sends still goes through the API-key + `content:read` gate.
 */

const GRAPHQL_ENDPOINT = '/api/graphql';

/**
 * Prefilled into GraphiQL's headers editor so the first request fails with a
 * clear "Invalid API key" rather than a bare "Missing Authorization header".
 * No angle brackets: the page inlines its options inside a <script> tag.
 */
export const GRAPHIQL_HEADERS_PLACEHOLDER = JSON.stringify(
  { Authorization: 'Bearer YOUR_CONTENT_READ_API_KEY' },
  null,
  2
);

/** "true" / "1" → on; everything else (including unset) → off. */
export function isGraphiqlEnabled(
  env: Readonly<Record<string, string | undefined>>
): boolean {
  const raw = env.BOJECT_GRAPHIQL;
  return raw === 'true' || raw === '1';
}

/** A browser navigation to the endpoint: a GET that accepts HTML. */
export function wantsGraphiqlPage(
  method: string,
  accept: string | undefined
): boolean {
  return method === 'GET' && !!accept?.includes('text/html');
}

export function renderGraphiqlPage(): string {
  return renderGraphiQL({
    title: 'boject GraphiQL',
    endpoint: GRAPHQL_ENDPOINT,
    headers: GRAPHIQL_HEADERS_PLACEHOLDER,
    // Keep pasted API keys out of the browser's localStorage.
    shouldPersistHeaders: false,
  });
}
