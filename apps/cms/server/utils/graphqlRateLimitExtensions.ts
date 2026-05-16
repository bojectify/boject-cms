import type { Plugin } from 'graphql-yoga';
import { isAsyncIterable } from 'graphql-yoga';
import type { H3Event } from 'h3';
import type { RateLimitSnapshot } from './rateLimit';
import { injectExtension } from './yogaExtensions';

/**
 * Yoga plugin that injects `extensions.rateLimit` on GraphQL responses
 * when the handler has stashed a snapshot on `event.context`. Lets
 * GraphQL-aware clients dispatch on `extensions.rateLimit.remaining`
 * without parsing HTTP headers. Dev mode skips the rate-limit gate so
 * no snapshot is present and the plugin is a no-op.
 */
export const rateLimitExtensionPlugin: Plugin = {
  onExecute({ args }) {
    return {
      onExecuteDone({ result, setResult }) {
        if (!result || isAsyncIterable(result)) return;
        const ctx = args.contextValue as { event?: H3Event };
        const snapshot = (
          ctx.event?.context as { rateLimitSnapshot?: RateLimitSnapshot }
        )?.rateLimitSnapshot;
        if (!snapshot) return;
        injectExtension(result, setResult, 'rateLimit', {
          limit: snapshot.limit,
          remaining: snapshot.remaining,
          reset: snapshot.resetSeconds,
        });
      },
    };
  },
};
