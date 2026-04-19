export function sanitiseProjectName(raw: string): string {
  const lowered = raw.toLowerCase();
  const replaced = lowered.replace(/[^a-z0-9._]+/g, '-');
  const trimmed = replaced.replace(/^-+|-+$/g, '');
  return trimmed.length > 0 ? trimmed : 'boject-site';
}
