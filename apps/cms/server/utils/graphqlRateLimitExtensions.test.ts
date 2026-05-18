import { describe, it, expect } from 'vitest';
import { parse, buildSchema } from 'graphql';
import type { H3Event } from 'h3';
import { rateLimitExtensionPlugin } from './graphqlRateLimitExtensions';
import type { RateLimitSnapshot } from './rateLimit';

const schema = buildSchema(/* GraphQL */ `
  type Query {
    hello: String
  }
`);

function makeEventWithSnapshot(
  snapshot: RateLimitSnapshot | undefined
): H3Event {
  return {
    node: { req: { headers: {} }, res: {} },
    context: snapshot ? { rateLimitSnapshot: snapshot } : {},
  } as H3Event;
}

describe('rateLimitExtensionPlugin', () => {
  it('injects extensions.rateLimit when a snapshot is present on event.context', () => {
    const event = makeEventWithSnapshot({
      allowed: true,
      limit: 1000,
      remaining: 873,
      resetSeconds: 1,
      retryAfterMs: 0,
    });

    let captured: { extensions?: Record<string, unknown> } = {};
    const document = parse(`{ hello }`);
    const args = {
      document,
      contextValue: { event },
      schema,
    } as unknown as Parameters<
      NonNullable<typeof rateLimitExtensionPlugin.onExecute>
    >[0]['args'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onExec = rateLimitExtensionPlugin.onExecute!({ args } as any);
    const onDone = (onExec as { onExecuteDone: (a: unknown) => void })
      .onExecuteDone;
    onDone({
      result: { data: { hello: 'world' } },
      setResult: (r: { extensions?: Record<string, unknown> }) => {
        captured = r;
      },
    });

    expect(captured.extensions?.rateLimit).toEqual({
      limit: 1000,
      remaining: 873,
      reset: 1,
    });
  });

  it('does nothing when no snapshot is on event.context', () => {
    const event = makeEventWithSnapshot(undefined);
    let setResultCalled = false;
    const document = parse(`{ hello }`);
    const args = {
      document,
      contextValue: { event },
      schema,
    } as unknown as Parameters<
      NonNullable<typeof rateLimitExtensionPlugin.onExecute>
    >[0]['args'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onExec = rateLimitExtensionPlugin.onExecute!({ args } as any);
    const onDone = (onExec as { onExecuteDone: (a: unknown) => void })
      .onExecuteDone;
    onDone({
      result: { data: { hello: 'world' } },
      setResult: () => {
        setResultCalled = true;
      },
    });

    expect(setResultCalled).toBe(false);
  });

  it('skips streaming results', () => {
    const event = makeEventWithSnapshot({
      allowed: true,
      limit: 1000,
      remaining: 100,
      resetSeconds: 1,
      retryAfterMs: 0,
    });
    let setResultCalled = false;
    const document = parse(`{ hello }`);
    const args = {
      document,
      contextValue: { event },
      schema,
    } as unknown as Parameters<
      NonNullable<typeof rateLimitExtensionPlugin.onExecute>
    >[0]['args'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onExec = rateLimitExtensionPlugin.onExecute!({ args } as any);
    const onDone = (onExec as { onExecuteDone: (a: unknown) => void })
      .onExecuteDone;
    onDone({
      result: (async function* () {
        yield { data: {} };
      })(),
      setResult: () => {
        setResultCalled = true;
      },
    });

    expect(setResultCalled).toBe(false);
  });

  it('injects extensions.rateLimit on errored queries (data: null) too', () => {
    const event = makeEventWithSnapshot({
      allowed: true,
      limit: 1000,
      remaining: 500,
      resetSeconds: 1,
      retryAfterMs: 0,
    });

    let captured: { extensions?: Record<string, unknown> } = {};
    const document = parse(`{ hello }`);
    const args = {
      document,
      contextValue: { event },
      schema,
    } as unknown as Parameters<
      NonNullable<typeof rateLimitExtensionPlugin.onExecute>
    >[0]['args'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onExec = rateLimitExtensionPlugin.onExecute!({ args } as any);
    const onDone = (onExec as { onExecuteDone: (a: unknown) => void })
      .onExecuteDone;
    onDone({
      result: {
        data: null,
        errors: [{ message: 'something broke' }],
      },
      setResult: (r: { extensions?: Record<string, unknown> }) => {
        captured = r;
      },
    });

    expect(captured.extensions?.rateLimit).toEqual({
      limit: 1000,
      remaining: 500,
      reset: 1,
    });
  });
});
