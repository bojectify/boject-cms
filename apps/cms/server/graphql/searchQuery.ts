import { resolveOffsetConnection } from '@pothos/plugin-relay';
import type { Builder } from './builder';
import { meili } from '../utils/meili';
import { resolveEntriesIndex } from '../utils/searchIndex';
import { runSearch, type SearchHit } from '../utils/searchEntries';
import type { SearchDocument } from '../utils/searchDocument';

/**
 * Register the public `searchEntries` GraphQL field — a Relay connection of
 * `SearchHit`s backed by the same `runSearch` core the REST `/api/search`
 * endpoint uses. Called from `buildSchema` on every schema (re)build, mirroring
 * `registerDynamicTypes`.
 */
export function registerSearchQuery(builder: Builder): void {
  const SearchFilterInput = builder.inputType('SearchFilterInput', {
    fields: (t) => ({
      field: t.string({ required: true }),
      value: t.string({ required: true }),
    }),
  });

  const SearchHitRef = builder.objectRef<SearchHit>('SearchHit').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      entryKey: t.exposeString('entryKey'),
      contentType: t.exposeString('contentType'),
      entryTitle: t.exposeString('entryTitle'),
      // Highlighted/cropped excerpt; null when Meili returns no formatted match.
      snippet: t.exposeString('snippet', { nullable: true }),
      publishedAt: t.field({
        type: 'DateTime',
        nullable: true,
        resolve: (h) => (h.publishedAt ? new Date(h.publishedAt) : null),
      }),
    }),
  });

  builder.queryField('searchEntries', (t) =>
    t.connection({
      type: SearchHitRef,
      args: {
        q: t.arg.string({ required: true }),
        contentType: t.arg.string(),
        filters: t.arg({ type: [SearchFilterInput] }),
      },
      resolve: (_parent, args) =>
        resolveOffsetConnection({ args }, async ({ limit, offset }) => {
          const res = await runSearch(
            meili.index<SearchDocument>(resolveEntriesIndex()),
            {
              q: args.q,
              contentType: args.contentType ?? undefined,
              filters: (args.filters ?? [])
                .filter((f): f is { field: string; value: string } => f != null)
                .map((f) => ({ field: f.field, value: f.value })),
              offset,
              limit,
            }
          );
          return res.hits;
        }),
    })
  );
}
