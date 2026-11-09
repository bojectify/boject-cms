export interface BojectConfigParams {
  /** Host port the CMS is published on (BOJECT_HOST_PORT in .env). */
  hostPort: number;
}

export function renderBojectConfig({ hostPort }: BojectConfigParams): string {
  const obj = {
    // Must match BOJECT_HOST_PORT in .env, or every CLI command — including
    // `boject upgrade`'s health check — targets the wrong port (#511).
    cms: { url: `http://localhost:${hostPort}` },
    schema: { path: 'content-types/schema.boject.json' },
  };
  return JSON.stringify(obj, null, 2) + '\n';
}
