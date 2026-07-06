#!/usr/bin/env tsx
// Bumps every publishable artifact to one unified version.
import { readFileSync, writeFileSync } from 'node:fs';

const VERSION_RE = /^\d+\.\d+\.\d+(-rc\.\d+)?$/;
const PACKAGE_JSONS = [
  'package.json',
  'apps/cms/package.json',
  'packages/boject-cli/package.json',
  'packages/create-boject-cms/package.json',
];

export function assertVersion(v: string): void {
  if (!VERSION_RE.test(v)) {
    throw new Error(`release-version: "${v}" is not X.Y.Z or X.Y.Z-rc.N`);
  }
}

export function bumpPackageJson(text: string, version: string): string {
  const re = /^(\s*"version"\s*:\s*)"[^"]*"/m;
  if (!re.test(text))
    throw new Error('release-version: no "version" field found');
  return text.replace(re, `$1"${version}"`);
}

export function bumpVersion(rootDir: string, version: string): void {
  assertVersion(version);
  for (const rel of PACKAGE_JSONS) {
    const p = `${rootDir}/${rel}`;
    writeFileSync(p, bumpPackageJson(readFileSync(p, 'utf8'), version));
  }
  writeFileSync(
    `${rootDir}/packages/boject-cli/src/version.ts`,
    `export const CLI_VERSION = '${version}';\n`
  );
  writeFileSync(
    `${rootDir}/packages/create-boject-cms/src/version.ts`,
    `export const IMAGE_TAG = 'ghcr.io/bojectify/boject-cms:${version}';\n`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const version = process.argv[2];
  if (!version) {
    console.error('usage: release-version <X.Y.Z | X.Y.Z-rc.N>');
    process.exit(2);
  }
  try {
    bumpVersion(process.cwd(), version);
    console.log(`[release-version] bumped all artifacts to ${version}`);
  } catch (err) {
    console.error(
      `[release-version] ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  }
}
