import type { ExecutionResult } from 'graphql';
import { isAsyncIterable } from 'graphql-yoga';

/**
 * Inject a single key into a Yoga execution result's extensions map.
 * Bails on streaming/multipart results (no canonical way to attach
 * extensions to an async iterator) and on falsy results. Centralised
 * so plugins like complexityYogaPlugin and rateLimitExtensionPlugin
 * stay in sync if Yoga's result contract evolves.
 */
export function injectExtension<TValue>(
  result: unknown,
  setResult: (r: ExecutionResult) => void,
  key: string,
  value: TValue
): void {
  if (!result || isAsyncIterable(result)) return;
  const exec = result as ExecutionResult;
  setResult({
    ...exec,
    extensions: { ...(exec.extensions ?? {}), [key]: value },
  });
}
