import type { H3Event } from 'h3';

/**
 * Server context passed from the /api/graphql handler into every Yoga
 * plugin via `yoga(req, res, { event })`. Plugins access the h3 event
 * via `args.contextValue.event` and read state stashed on
 * `event.context` (e.g. `rateLimitSnapshot`).
 */
export interface YogaServerContext {
  event: H3Event;
}
