import { describe, expect, it } from 'vitest';
import { renderPackageJson } from '../../src/templates/packageJson.js';

describe('renderPackageJson', () => {
  it('returns valid JSON', () => {
    const output = renderPackageJson({ name: 'my-site' });
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('sets the name from the parameter', () => {
    const parsed = JSON.parse(renderPackageJson({ name: 'my-site' }));
    expect(parsed.name).toBe('my-site');
  });

  it('is private and unversioned (0.1.0)', () => {
    const parsed = JSON.parse(renderPackageJson({ name: 'x' }));
    expect(parsed.private).toBe(true);
    expect(parsed.version).toBe('0.1.0');
  });

  it('defines start/stop/logs/upgrade scripts', () => {
    const parsed = JSON.parse(renderPackageJson({ name: 'x' }));
    expect(parsed.scripts).toEqual({
      start: 'docker compose up -d',
      stop: 'docker compose down',
      logs: 'docker compose logs -f cms',
      upgrade: 'npx @boject/cli@latest upgrade',
    });
  });

  it('declares no dependencies', () => {
    const parsed = JSON.parse(renderPackageJson({ name: 'x' }));
    expect(parsed.dependencies).toBeUndefined();
    expect(parsed.devDependencies).toBeUndefined();
  });

  it('ends with a trailing newline', () => {
    const output = renderPackageJson({ name: 'x' });
    expect(output.endsWith('\n')).toBe(true);
  });
});
