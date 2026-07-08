import { describe, expect, it } from 'vitest';
import { renderDockerCompose } from '../../src/templates/dockerCompose.js';

describe('renderDockerCompose', () => {
  it('pins cms.image to the supplied tag', () => {
    const yml = renderDockerCompose({
      imageTag: 'ghcr.io/bojectify/boject-cms:1.2.3',
      starter: 'web-base',
    });
    expect(yml).toContain('image: ghcr.io/bojectify/boject-cms:1.2.3');
  });

  it('wires the db service as postgres:17 with boject credentials', () => {
    const yml = renderDockerCompose({ imageTag: 'x', starter: 'web-base' });
    expect(yml).toContain('image: postgres:17');
    expect(yml).toContain('POSTGRES_USER: boject');
    expect(yml).toContain('POSTGRES_PASSWORD: boject');
    expect(yml).toContain('POSTGRES_DB: boject');
  });

  it('maps the CMS via BOJECT_HOST_PORT (default 4000) → container 3000', () => {
    const yml = renderDockerCompose({ imageTag: 'x', starter: 'web-base' });
    expect(yml).toContain("'${BOJECT_HOST_PORT:-4000}:3000'");
  });

  it('declares pgdata and storage named volumes', () => {
    const yml = renderDockerCompose({ imageTag: 'x', starter: 'web-base' });
    expect(yml).toMatch(/^volumes:/m);
    expect(yml).toContain('pgdata:');
    expect(yml).toContain('storage:');
  });

  it('mounts ./starters:/starters:ro when starter is not "none"', () => {
    const yml = renderDockerCompose({ imageTag: 'x', starter: 'sport' });
    expect(yml).toContain('./starters:/starters:ro');
  });

  it('omits the starters bind-mount when starter is "none"', () => {
    const yml = renderDockerCompose({ imageTag: 'x', starter: 'none' });
    expect(yml).not.toContain('./starters:/starters:ro');
  });

  it('sets env_file to .env for the cms service', () => {
    const yml = renderDockerCompose({ imageTag: 'x', starter: 'web-base' });
    expect(yml).toContain('env_file:');
    expect(yml).toContain('- .env');
  });

  it('ends with a trailing newline', () => {
    const yml = renderDockerCompose({ imageTag: 'x', starter: 'web-base' });
    expect(yml.endsWith('\n')).toBe(true);
  });

  it('always includes the content-types bind mount', () => {
    for (const starter of [
      'web-base',
      'articles',
      'sport',
      'rugby',
      'none',
    ] as const) {
      const out = renderDockerCompose({
        imageTag: 'boject/cms:dev',
        starter,
      });
      expect(out).toContain('./content-types:/app/content-types:ro');
    }
  });

  it('defines a meilisearch service pinned to v1.45.2 in production mode', () => {
    const yml = renderDockerCompose({ imageTag: 'x', starter: 'web-base' });
    expect(yml).toMatch(/^ {2}meilisearch:$/m);
    expect(yml).toContain('image: getmeili/meilisearch:v1.45.2');
    expect(yml).toContain('MEILI_ENV: production');
    expect(yml).toContain("MEILI_NO_ANALYTICS: 'true'");
    // Master key is interpolated from .env, never baked into the compose file.
    expect(yml).toContain('MEILI_MASTER_KEY: ${MEILI_MASTER_KEY}');
  });

  it('gives meilisearch a persistent meilidata volume', () => {
    const yml = renderDockerCompose({ imageTag: 'x', starter: 'web-base' });
    expect(yml).toContain('- meilidata:/meili_data');
    expect(yml).toMatch(/^ {2}meilidata:$/m);
  });

  it('defines a redis service pinned to 7.4-alpine with no persistence', () => {
    const yml = renderDockerCompose({ imageTag: 'x', starter: 'web-base' });
    expect(yml).toMatch(/^ {2}redis:$/m);
    expect(yml).toContain('image: redis:7.4-alpine');
    expect(yml).toContain('command: redis-server --save "" --appendonly no');
  });

  it('does not give redis a volume (cold-on-restart cache)', () => {
    const yml = renderDockerCompose({ imageTag: 'x', starter: 'web-base' });
    expect(yml).not.toContain('redisdata');
  });

  it('makes cms depend on db, meilisearch, and redis', () => {
    const yml = renderDockerCompose({ imageTag: 'x', starter: 'web-base' });
    expect(yml).toMatch(/depends_on:\n\s+- db\n\s+- meilisearch\n\s+- redis/);
  });
});
