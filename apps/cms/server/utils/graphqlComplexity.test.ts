import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { parse, buildSchema } from 'graphql';
import type { H3Event } from 'h3';
import {
  DEFAULT_GRAPHQL_COMPLEXITY_MAX_COST,
  getGraphqlComplexityMaxCost,
  isGraphqlComplexityLogOnly,
  complexityYogaPlugin,
  __test__,
} from './graphqlComplexity';

describe('getGraphqlComplexityMaxCost', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns the default when env var is unset', () => {
    vi.stubEnv('BOJECT_GRAPHQL_COMPLEXITY_MAX_COST', '');
    expect(getGraphqlComplexityMaxCost()).toBe(
      DEFAULT_GRAPHQL_COMPLEXITY_MAX_COST
    );
  });

  it('returns the parsed value when env var is a positive number', () => {
    vi.stubEnv('BOJECT_GRAPHQL_COMPLEXITY_MAX_COST', '500');
    expect(getGraphqlComplexityMaxCost()).toBe(500);
  });

  it('falls back to default on non-numeric env var', () => {
    vi.stubEnv('BOJECT_GRAPHQL_COMPLEXITY_MAX_COST', 'abc');
    expect(getGraphqlComplexityMaxCost()).toBe(
      DEFAULT_GRAPHQL_COMPLEXITY_MAX_COST
    );
  });

  it('falls back to default on zero', () => {
    vi.stubEnv('BOJECT_GRAPHQL_COMPLEXITY_MAX_COST', '0');
    expect(getGraphqlComplexityMaxCost()).toBe(
      DEFAULT_GRAPHQL_COMPLEXITY_MAX_COST
    );
  });

  it('falls back to default on negative number', () => {
    vi.stubEnv('BOJECT_GRAPHQL_COMPLEXITY_MAX_COST', '-1');
    expect(getGraphqlComplexityMaxCost()).toBe(
      DEFAULT_GRAPHQL_COMPLEXITY_MAX_COST
    );
  });
});

describe('isGraphqlComplexityLogOnly', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns false when env var is unset', () => {
    vi.stubEnv('BOJECT_GRAPHQL_COMPLEXITY_LOG_ONLY', '');
    expect(isGraphqlComplexityLogOnly()).toBe(false);
  });

  it('returns true on "true"', () => {
    vi.stubEnv('BOJECT_GRAPHQL_COMPLEXITY_LOG_ONLY', 'true');
    expect(isGraphqlComplexityLogOnly()).toBe(true);
  });

  it('returns true on "1"', () => {
    vi.stubEnv('BOJECT_GRAPHQL_COMPLEXITY_LOG_ONLY', '1');
    expect(isGraphqlComplexityLogOnly()).toBe(true);
  });

  it('returns false on any other value', () => {
    vi.stubEnv('BOJECT_GRAPHQL_COMPLEXITY_LOG_ONLY', 'no');
    expect(isGraphqlComplexityLogOnly()).toBe(false);
  });
});

const schema = buildSchema(/* GraphQL */ `
  type Query {
    hello: String
  }
`);

type MockEvent = {
  headers: Map<string, string>;
  event: H3Event;
};

function makeMockEvent(): MockEvent {
  const headers = new Map<string, string>();
  const event = {
    node: {
      req: { headers: {} },
      res: {
        headersSent: false,
        setHeader(name: string, value: string | number | string[]) {
          headers.set(name.toLowerCase(), String(value));
        },
        getHeader(name: string) {
          return headers.get(name.toLowerCase());
        },
      },
    },
    context: {},
  } as H3Event;
  return { headers, event };
}

describe('complexityYogaPlugin response surfacing', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('injects extensions.queryCost on the result and sets X-Query-Cost header', () => {
    const document = parse(`{ hello }`);
    __test__.setCostForDocument(document, 42);
    const { event, headers } = makeMockEvent();

    let captured: { result?: { extensions?: Record<string, unknown> } } = {};
    // eslint-disable-next-line no-restricted-syntax -- Yoga TypedExecutionArgs requires params/request/waitUntil the mock omits
    const args = {
      document,
      contextValue: { event },
      schema,
    } as unknown as Parameters<
      NonNullable<typeof complexityYogaPlugin.onExecute>
    >[0]['args'];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onExec = complexityYogaPlugin.onExecute!({ args } as any);
    const onDone = (onExec as { onExecuteDone: (a: unknown) => void })
      .onExecuteDone;
    onDone({
      result: { data: { hello: 'world' } },
      setResult: (r: { extensions?: Record<string, unknown> }) => {
        captured = { result: r };
      },
    });

    expect(headers.get('x-query-cost')).toBe('42');
    expect(captured.result?.extensions?.queryCost).toEqual({
      cost: 42,
      cap: getGraphqlComplexityMaxCost(),
    });
  });

  it('does nothing when no cost was recorded for this document', () => {
    const document = parse(`{ hello }`);
    const { event, headers } = makeMockEvent();

    let setResultCalled = false;
    // eslint-disable-next-line no-restricted-syntax -- Yoga TypedExecutionArgs requires params/request/waitUntil the mock omits
    const args = {
      document,
      contextValue: { event },
      schema,
    } as unknown as Parameters<
      NonNullable<typeof complexityYogaPlugin.onExecute>
    >[0]['args'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onExec = complexityYogaPlugin.onExecute!({ args } as any);
    const onDone = (onExec as { onExecuteDone: (a: unknown) => void })
      .onExecuteDone;
    onDone({
      result: { data: { hello: 'world' } },
      setResult: () => {
        setResultCalled = true;
      },
    });

    expect(headers.get('x-query-cost')).toBeUndefined();
    expect(setResultCalled).toBe(false);
  });

  it('skips streaming/multipart results gracefully', () => {
    const document = parse(`{ hello }`);
    __test__.setCostForDocument(document, 10);
    const { event } = makeMockEvent();

    let setResultCalled = false;
    // eslint-disable-next-line no-restricted-syntax -- Yoga TypedExecutionArgs requires params/request/waitUntil the mock omits
    const args = {
      document,
      contextValue: { event },
      schema,
    } as unknown as Parameters<
      NonNullable<typeof complexityYogaPlugin.onExecute>
    >[0]['args'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onExec = complexityYogaPlugin.onExecute!({ args } as any);
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

  it('surfaces cost=0 as a real value (not falsy-skipped)', () => {
    const document = parse(`{ hello }`);
    __test__.setCostForDocument(document, 0);
    const { event, headers } = makeMockEvent();

    let captured: { result?: { extensions?: Record<string, unknown> } } = {};
    // eslint-disable-next-line no-restricted-syntax -- Yoga TypedExecutionArgs requires params/request/waitUntil the mock omits
    const args = {
      document,
      contextValue: { event },
      schema,
    } as unknown as Parameters<
      NonNullable<typeof complexityYogaPlugin.onExecute>
    >[0]['args'];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onExec = complexityYogaPlugin.onExecute!({ args } as any);
    const onDone = (onExec as { onExecuteDone: (a: unknown) => void })
      .onExecuteDone;
    onDone({
      result: { data: { hello: 'world' } },
      setResult: (r: { extensions?: Record<string, unknown> }) => {
        captured = { result: r };
      },
    });

    expect(headers.get('x-query-cost')).toBe('0');
    expect(captured.result?.extensions?.queryCost).toEqual({
      cost: 0,
      cap: getGraphqlComplexityMaxCost(),
    });
  });
});
