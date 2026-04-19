import { describe, expect, it } from 'vitest';
import { renderDockerCompose } from '../../src/templates/dockerCompose.js';

describe('renderDockerCompose', () => {
  it('pins cms.image to the supplied tag', () => {
    const yml = renderDockerCompose({
      imageTag: 'ghcr.io/boject/cms:1.2.3',
      starter: 'base',
    });
    expect(yml).toContain('image: ghcr.io/boject/cms:1.2.3');
  });

  it('wires the db service as postgres:17 with boject credentials', () => {
    const yml = renderDockerCompose({ imageTag: 'x', starter: 'base' });
    expect(yml).toContain('image: postgres:17');
    expect(yml).toContain('POSTGRES_USER: boject');
    expect(yml).toContain('POSTGRES_PASSWORD: boject');
    expect(yml).toContain('POSTGRES_DB: boject');
  });

  it('exposes cms on host port 4000 → container 3000', () => {
    const yml = renderDockerCompose({ imageTag: 'x', starter: 'base' });
    expect(yml).toContain("'4000:3000'");
  });

  it('declares pgdata and storage named volumes', () => {
    const yml = renderDockerCompose({ imageTag: 'x', starter: 'base' });
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
    const yml = renderDockerCompose({ imageTag: 'x', starter: 'base' });
    expect(yml).toContain('env_file:');
    expect(yml).toContain('- .env');
  });

  it('ends with a trailing newline', () => {
    const yml = renderDockerCompose({ imageTag: 'x', starter: 'base' });
    expect(yml.endsWith('\n')).toBe(true);
  });
});
