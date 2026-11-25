import type { H3Event } from 'h3';
import { afterEach, describe, expect, it } from 'vitest';
import { assertSchemaEditable } from './schemaReadOnly';

// #527: the flag must be read from the environment when the request runs.
// It used to come from runtimeConfig, which Nuxt fills from nuxt.config.ts at
// BUILD time — the published image baked `schemaReadonly: false`, so
// BOJECT_SCHEMA_READONLY=true on the container locked nothing.
describe('assertSchemaEditable', () => {
  const saved = process.env.BOJECT_SCHEMA_READONLY;
  const event = {} as H3Event;

  afterEach(() => {
    if (saved === undefined) delete process.env.BOJECT_SCHEMA_READONLY;
    else process.env.BOJECT_SCHEMA_READONLY = saved;
  });

  it('throws 403 SCHEMA_READONLY when BOJECT_SCHEMA_READONLY is set at request time', () => {
    process.env.BOJECT_SCHEMA_READONLY = 'true';
    expect(() => assertSchemaEditable(event)).toThrowError(
      expect.objectContaining({
        statusCode: 403,
        data: { error: 'SCHEMA_READONLY' },
      })
    );
  });

  it('honours "1" as well as "true"', () => {
    process.env.BOJECT_SCHEMA_READONLY = '1';
    expect(() => assertSchemaEditable(event)).toThrowError(
      expect.objectContaining({ statusCode: 403 })
    );
  });

  it('allows schema edits when the flag is unset', () => {
    delete process.env.BOJECT_SCHEMA_READONLY;
    expect(() => assertSchemaEditable(event)).not.toThrow();
  });
});
