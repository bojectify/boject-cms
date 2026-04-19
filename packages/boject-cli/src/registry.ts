import semver from 'semver';

export interface ImageRef {
  registry: string;
  repository: string;
  tag: string;
}

export function parseImageRef(ref: string): ImageRef {
  const lastColon = ref.lastIndexOf(':');
  const firstSlash = ref.indexOf('/');
  if (lastColon <= firstSlash || firstSlash < 0) {
    if (firstSlash < 0) {
      throw new Error(`Image ref "${ref}" has no registry component`);
    }
    throw new Error(`Image ref "${ref}" has no tag`);
  }
  const registry = ref.slice(0, firstSlash);
  if (
    !registry.includes('.') &&
    !registry.includes(':') &&
    registry !== 'localhost'
  ) {
    throw new Error(
      `Image ref "${ref}" has no registry component (expected e.g. ghcr.io/<repo>:<tag>)`
    );
  }
  const repository = ref.slice(firstSlash + 1, lastColon);
  const tag = ref.slice(lastColon + 1);
  if (repository.length === 0 || tag.length === 0) {
    throw new Error(`Image ref "${ref}" is malformed`);
  }
  return { registry, repository, tag };
}

export function pickHighestSemver(tags: string[]): string | null {
  const semverTags = tags.filter((t) => semver.valid(t) !== null);
  if (semverTags.length === 0) return null;
  semverTags.sort(semver.rcompare);
  return semverTags[0] ?? null;
}

export interface ListTagsParams {
  registry: string;
  repository: string;
}

function registryScheme(registry: string): string {
  return registry.startsWith('localhost') ? 'http' : 'https';
}

interface BearerChallenge {
  realm: string;
  service?: string;
  scope?: string;
}

function parseBearerChallenge(header: string): BearerChallenge | null {
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const params: Record<string, string> = {};
  const body = header.slice(7);
  for (const match of body.matchAll(/(\w+)="([^"]*)"/g)) {
    params[match[1]] = match[2];
  }
  if (!params.realm) return null;
  return { realm: params.realm, service: params.service, scope: params.scope };
}

async function fetchToken(challenge: BearerChallenge): Promise<string> {
  const url = new URL(challenge.realm);
  if (challenge.service) url.searchParams.set('service', challenge.service);
  if (challenge.scope) url.searchParams.set('scope', challenge.scope);
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Token endpoint ${url.toString()} returned ${res.status}`);
  }
  const body = (await res.json()) as { token?: string; access_token?: string };
  const token = body.token ?? body.access_token;
  if (!token) {
    throw new Error(`Token endpoint ${url.toString()} returned no token`);
  }
  return token;
}

export async function listTags(params: ListTagsParams): Promise<string[]> {
  const url = `${registryScheme(params.registry)}://${params.registry}/v2/${params.repository}/tags/list`;
  const res = await fetch(url, { headers: {} });
  if (res.status === 200) {
    const body = (await res.json()) as { tags?: string[] };
    return body.tags ?? [];
  }
  if (res.status === 401) {
    const challenge = parseBearerChallenge(
      res.headers.get('www-authenticate') ?? ''
    );
    if (!challenge) {
      throw new Error(
        `${url} returned 401 without a parseable WWW-Authenticate header`
      );
    }
    const token = await fetchToken(challenge);
    const retry = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!retry.ok) {
      throw new Error(`${url} returned ${retry.status} after token auth`);
    }
    const body = (await retry.json()) as { tags?: string[] };
    return body.tags ?? [];
  }
  throw new Error(`${url} returned ${res.status}`);
}
