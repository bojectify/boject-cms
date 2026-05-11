import type { RunMetadata } from './render.js';
import type { RunMode } from './runMode.js';

export interface PartialMetaInputs {
  mode: RunMode;
  contentType: string;
  url: string | null;
  cliVersion: string;
  k6Version: string;
  partialFailureSource: 'reset' | 'seed';
  seedSize: number | null;
  seedDeterministicSeed: number | null;
}

export function buildPartialMeta(i: PartialMetaInputs): RunMetadata {
  const targetUrl = i.url ? safeParseUrl(i.url) : null;
  return {
    perfCalibratedAt: new Date().toISOString(),
    cliVersion: i.cliVersion,
    k6Version: i.k6Version,
    targetHost: targetUrl?.host ?? 'unknown',
    targetScheme: targetUrl?.protocol === 'http:' ? 'http' : 'https',
    contentType: i.contentType,
    fields: { list: 'unknown', filter: null, relation: null },
    scenarios: [],
    intensity: { targetRps: 0, duration: '0s', stages: [] },
    mode: i.mode,
    seedSize: i.seedSize,
    seedDeterministicSeed: i.seedDeterministicSeed,
    partial: true,
    partialFailureSource: i.partialFailureSource,
  };
}

function safeParseUrl(u: string): URL | null {
  try {
    return new URL(u);
  } catch {
    return null;
  }
}
