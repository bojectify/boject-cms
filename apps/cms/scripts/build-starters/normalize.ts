// scripts/build-starters/normalize.ts
export function normalize(content: string): string {
  const parsed = JSON.parse(content) as Record<string, unknown>;
  parsed.exportedAt = '';
  return JSON.stringify(parsed, null, 2) + '\n';
}
