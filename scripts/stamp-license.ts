#!/usr/bin/env tsx
// Stamps the BSL LICENSE placeholder tokens for a published artifact and strips
// the trailing non-normative "Change Date notice" (repo-source-form only).
// Fails loudly if a token is missing (drift / already stamped / wrong file).
import { readFileSync, writeFileSync } from 'node:fs';

const NOTICE_MARKER = 'Change Date notice (non-normative';
const SEPARATOR = '\n---';

export function addYearsUTC(dateISO: string, years: number): string {
  const [y, m, d] = dateISO.split('-');
  return `${String(Number(y) + years).padStart(4, '0')}-${m}-${d}`;
}

export function stampLicense(
  text: string,
  opts: { version: string; date: string }
): string {
  let out = text;
  const markerIdx = out.indexOf(NOTICE_MARKER);
  if (markerIdx !== -1) {
    const sepIdx = out.slice(0, markerIdx).lastIndexOf(SEPARATOR);
    out =
      out.slice(0, sepIdx !== -1 ? sepIdx : markerIdx).replace(/\s+$/, '') +
      '\n';
  }
  if (!out.includes('%%VERSION%%')) {
    throw new Error(
      'stamp-license: %%VERSION%% token not found (drift or already stamped?)'
    );
  }
  if (!out.includes('%%CHANGE_DATE%%')) {
    throw new Error(
      'stamp-license: %%CHANGE_DATE%% token not found (drift or already stamped?)'
    );
  }
  return out
    .replaceAll('%%VERSION%%', opts.version)
    .replaceAll('%%CHANGE_DATE%%', opts.date);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const path = args[0];
  const vi = args.indexOf('--version');
  const di = args.indexOf('--date');
  if (!path || vi === -1 || !args[vi + 1]) {
    console.error(
      'usage: stamp-license <path> --version <v> [--date <YYYY-MM-DD>]'
    );
    process.exit(2);
  }
  const version = args[vi + 1];
  const today = new Date().toISOString().slice(0, 10);
  const date = di !== -1 && args[di + 1] ? args[di + 1] : addYearsUTC(today, 4);
  try {
    writeFileSync(
      path,
      stampLicense(readFileSync(path, 'utf8'), { version, date })
    );
    console.log(
      `[stamp-license] ${path}: version=${version} changeDate=${date}`
    );
  } catch (err) {
    console.error(
      `[stamp-license] ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  }
}
