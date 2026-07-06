import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertVersion, bumpPackageJson, bumpVersion } from './release-version';

describe('assertVersion', () => {
  it('accepts X.Y.Z and X.Y.Z-rc.N', () => {
    expect(() => assertVersion('1.2.3')).not.toThrow();
    expect(() => assertVersion('0.0.1-rc.1')).not.toThrow();
  });
  it('rejects anything else', () => {
    for (const bad of ['v1.2.3', '1.2', '1.2.3-beta.1', '1.2.3-rc', 'x']) {
      expect(() => assertVersion(bad)).toThrow();
    }
  });
});

describe('bumpPackageJson', () => {
  it('replaces only the version value, preserving formatting', () => {
    const src =
      '{\n  "name": "x",\n  "version": "0.0.1-rc.1",\n  "private": true\n}\n';
    expect(bumpPackageJson(src, '0.0.2')).toBe(
      '{\n  "name": "x",\n  "version": "0.0.2",\n  "private": true\n}\n'
    );
  });
});

describe('bumpVersion', () => {
  it('bumps all 4 package.json + both version.ts', () => {
    const root = mkdtempSync(join(tmpdir(), 'relver-'));
    const pkgs = [
      'package.json',
      'apps/cms/package.json',
      'packages/boject-cli/package.json',
      'packages/create-boject-cms/package.json',
    ];
    for (const rel of pkgs) {
      mkdirSync(join(root, rel, '..'), { recursive: true });
      writeFileSync(join(root, rel), '{\n  "version": "0.0.1-rc.1"\n}\n');
    }
    mkdirSync(join(root, 'packages/boject-cli/src'), { recursive: true });
    mkdirSync(join(root, 'packages/create-boject-cms/src'), {
      recursive: true,
    });
    writeFileSync(
      join(root, 'packages/boject-cli/src/version.ts'),
      "export const CLI_VERSION = '0.0.1-rc.1';\n"
    );
    writeFileSync(
      join(root, 'packages/create-boject-cms/src/version.ts'),
      "export const IMAGE_TAG = 'ghcr.io/bojectify/boject-cms:latest';\n"
    );

    bumpVersion(root, '1.4.2');

    for (const rel of pkgs)
      expect(readFileSync(join(root, rel), 'utf8')).toContain(
        '"version": "1.4.2"'
      );
    expect(
      readFileSync(join(root, 'packages/boject-cli/src/version.ts'), 'utf8')
    ).toBe("export const CLI_VERSION = '1.4.2';\n");
    expect(
      readFileSync(
        join(root, 'packages/create-boject-cms/src/version.ts'),
        'utf8'
      )
    ).toBe("export const IMAGE_TAG = 'ghcr.io/bojectify/boject-cms:1.4.2';\n");
  });
});
