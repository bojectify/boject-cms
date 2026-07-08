import { describe, expect, it } from 'vitest';
import { renderEnvFile } from '../../src/templates/envFile.js';
import { STARTERS } from './repoStarters.js';

const baseParams = {
  sessionPassword: 'session-password-value',
  adminPassword: 'admin-password-value',
  meiliMasterKey: 'meili-master-key-value',
  hostPort: 4000,
};

describe('renderEnvFile', () => {
  it('includes DATABASE_URL pointed at the compose db service', () => {
    const env = renderEnvFile({ ...baseParams, starter: 'web-base' });
    expect(env).toMatch(
      /^DATABASE_URL=postgresql:\/\/boject:boject@db:5432\/boject$/m
    );
  });

  it('includes NUXT_SESSION_PASSWORD from parameter', () => {
    const env = renderEnvFile({ ...baseParams, starter: 'web-base' });
    expect(env).toMatch(/^NUXT_SESSION_PASSWORD=session-password-value$/m);
  });

  it('includes BOJECT_ADMIN_EMAIL=admin@local', () => {
    const env = renderEnvFile({ ...baseParams, starter: 'web-base' });
    expect(env).toMatch(/^BOJECT_ADMIN_EMAIL=admin@local$/m);
  });

  it('includes BOJECT_ADMIN_PASSWORD from parameter', () => {
    const env = renderEnvFile({ ...baseParams, starter: 'web-base' });
    expect(env).toMatch(/^BOJECT_ADMIN_PASSWORD=admin-password-value$/m);
  });

  it('includes STORAGE_DRIVER=local', () => {
    const env = renderEnvFile({ ...baseParams, starter: 'web-base' });
    expect(env).toMatch(/^STORAGE_DRIVER=local$/m);
  });

  it('includes BOJECT_INITIAL_STARTER when starter is not "none"', () => {
    const env = renderEnvFile({ ...baseParams, starter: 'sport' });
    expect(env).toMatch(
      /^BOJECT_INITIAL_STARTER=\/starters\/sport\.boject\.json$/m
    );
  });

  it('omits BOJECT_INITIAL_STARTER when starter is "none"', () => {
    const env = renderEnvFile({ ...baseParams, starter: 'none' });
    expect(env).not.toMatch(/BOJECT_INITIAL_STARTER/);
  });

  it('ends with a trailing newline', () => {
    const env = renderEnvFile({ ...baseParams, starter: 'web-base' });
    expect(env.endsWith('\n')).toBe(true);
  });

  it('includes a commented BOJECT_SCHEMA_READONLY opt-in line', () => {
    const env = renderEnvFile({ ...baseParams, starter: 'web-base' });
    expect(env).toMatch(/^# BOJECT_SCHEMA_READONLY=true$/m);
  });

  it('does not enable BOJECT_SCHEMA_READONLY by default', () => {
    const env = renderEnvFile({ ...baseParams, starter: 'web-base' });
    // Match a non-commented assignment specifically — the commented
    // form is allowed and asserted above.
    expect(env).not.toMatch(/^BOJECT_SCHEMA_READONLY=/m);
  });

  it('always includes BOJECT_SCHEMA_DIR=/app/content-types', () => {
    for (const starter of [...STARTERS, 'none']) {
      const out = renderEnvFile({
        sessionPassword: 'pw1',
        adminPassword: 'pw2',
        meiliMasterKey: 'pw3',
        starter,
        hostPort: 4000,
      });
      expect(out).toContain('BOJECT_SCHEMA_DIR=/app/content-types');
    }
  });

  it('includes the commented BOJECT_ALLOW_DESTRUCTIVE_SCHEMA line with a comment', () => {
    const out = renderEnvFile({
      sessionPassword: 'pw1',
      adminPassword: 'pw2',
      meiliMasterKey: 'pw3',
      starter: 'web-base',
      hostPort: 4000,
    });
    expect(out).toContain('# BOJECT_ALLOW_DESTRUCTIVE_SCHEMA=true');
    // The comment block above the line should explain when to enable it.
    expect(out).toMatch(/destructive|removal/i);
  });

  it('includes a commented BOJECT_API_KEY line', () => {
    const env = renderEnvFile({ ...baseParams, starter: 'web-base' });
    expect(env).toMatch(/^# BOJECT_API_KEY=/m);
    expect(env).toMatch(/CLI|boject schema/i);
  });

  it('does not enable BOJECT_API_KEY by default', () => {
    const env = renderEnvFile({ ...baseParams, starter: 'web-base' });
    expect(env).not.toMatch(/^BOJECT_API_KEY=/m);
  });

  it('includes BOJECT_HOST_PORT from the hostPort parameter', () => {
    const env = renderEnvFile({
      ...baseParams,
      starter: 'web-base',
      hostPort: 4100,
    });
    expect(env).toMatch(/^BOJECT_HOST_PORT=4100$/m);
  });

  it('includes MEILI_URL pointed at the compose meilisearch service', () => {
    const env = renderEnvFile({ ...baseParams, starter: 'web-base' });
    expect(env).toMatch(/^MEILI_URL=http:\/\/meilisearch:7700$/m);
  });

  it('includes MEILI_MASTER_KEY from parameter', () => {
    const env = renderEnvFile({ ...baseParams, starter: 'web-base' });
    expect(env).toMatch(/^MEILI_MASTER_KEY=meili-master-key-value$/m);
  });

  it('includes REDIS_URL pointed at the compose redis service', () => {
    const env = renderEnvFile({ ...baseParams, starter: 'web-base' });
    expect(env).toMatch(/^REDIS_URL=redis:\/\/redis:6379$/m);
  });
});
