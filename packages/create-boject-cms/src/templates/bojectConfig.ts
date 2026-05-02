export function renderBojectConfig(): string {
  const obj = {
    cms: { url: 'http://localhost:4000' },
    schema: { path: 'content-types/schema.boject.json' },
  };
  return JSON.stringify(obj, null, 2) + '\n';
}
