import { describe, expect, it } from 'vitest';
import { buildPartialMeta } from './buildPartialMeta.js';

describe('buildPartialMeta', () => {
  it("emits a RunMetadata with partial:true and partialFailureSource:'reset' for the reset case", () => {
    const meta = buildPartialMeta({
      mode: 'seed-direct',
      contentType: 'Article',
      url: 'https://cms.example.com/api/graphql',
      cliVersion: '1.2.3',
      k6Version: 'k6 v0.50.0',
      partialFailureSource: 'reset',
      seedSize: null,
      seedDeterministicSeed: null,
    });
    expect(meta).toMatchObject({
      cliVersion: '1.2.3',
      k6Version: 'k6 v0.50.0',
      targetHost: 'cms.example.com',
      targetScheme: 'https',
      contentType: 'Article',
      fields: { list: 'unknown', filter: null, relation: null },
      scenarios: [],
      intensity: { targetRps: 0, duration: '0s', stages: [] },
      mode: 'seed-direct',
      seedSize: null,
      seedDeterministicSeed: null,
      partial: true,
      partialFailureSource: 'reset',
    });
    expect(typeof meta.perfCalibratedAt).toBe('string');
    expect(() => new Date(meta.perfCalibratedAt).toISOString()).not.toThrow();
  });

  it("preserves the realised seed count when partialFailureSource is 'seed'", () => {
    const meta = buildPartialMeta({
      mode: 'seed-http',
      contentType: 'Article',
      url: 'http://cms.local/api/graphql',
      cliVersion: '1.2.3',
      k6Version: 'k6 v0.50.0',
      partialFailureSource: 'seed',
      seedSize: 50,
      seedDeterministicSeed: 7,
    });
    expect(meta.partial).toBe(true);
    expect(meta.partialFailureSource).toBe('seed');
    expect(meta.seedSize).toBe(50);
    expect(meta.seedDeterministicSeed).toBe(7);
    // http URLs round-trip to scheme 'http'
    expect(meta.targetScheme).toBe('http');
    expect(meta.targetHost).toBe('cms.local');
  });

  it("falls back to targetHost 'unknown' and scheme 'https' when url is null", () => {
    const meta = buildPartialMeta({
      mode: 'read-only',
      contentType: 'Article',
      url: null,
      cliVersion: '1.2.3',
      k6Version: 'k6 v0.50.0',
      partialFailureSource: 'reset',
      seedSize: null,
      seedDeterministicSeed: null,
    });
    expect(meta.targetHost).toBe('unknown');
    expect(meta.targetScheme).toBe('https');
    expect(meta.partial).toBe(true);
  });

  it("falls back to targetHost 'unknown' when url is unparseable", () => {
    const meta = buildPartialMeta({
      mode: 'seed-direct',
      contentType: 'Article',
      url: 'not a url',
      cliVersion: '1.2.3',
      k6Version: 'k6 v0.50.0',
      partialFailureSource: 'seed',
      seedSize: null,
      seedDeterministicSeed: null,
    });
    expect(meta.targetHost).toBe('unknown');
    expect(meta.targetScheme).toBe('https');
  });
});
