import type { FieldType } from '#prisma';
import { assertUniqueFieldValues } from './assertUniqueFieldValues';
import { enrichEntryDataWithEmbedIdentifiers } from './enrichRichtextEmbeds';

// WriteContentType is declared HERE (the canonical home) and re-exported from
// createEntry.ts for convenience. It is structurally equal to
// PublishableEntry['contentType'].
export type WriteContentType = {
  id: string;
  identifier: string;
  fields: Array<{
    id: string;
    identifier: string;
    name: string;
    type: FieldType;
    required: boolean;
    unique: boolean;
    options: unknown;
    order: number;
  }>;
};

/**
 * The shared validation core for every entry write path (admin + public,
 * create + draft + publish): validate field values, enforce per-field
 * uniqueness (skipping `excludeEntryId` on updates), then stamp richtext
 * embed/link identifiers. Returns the validated + enriched data.
 */
export async function validateAndEnrichEntryData(
  contentType: { id: string; fields: WriteContentType['fields'] },
  rawData: Record<string, unknown>,
  opts: { excludeEntryId?: string } = {}
): Promise<Record<string, unknown>> {
  const validated = await validateEntryData(rawData, contentType.fields);
  await assertUniqueFieldValues(
    validated,
    contentType.fields,
    contentType.id,
    opts.excludeEntryId
  );
  return enrichEntryDataWithEmbedIdentifiers(validated, contentType.fields, {
    loadIdentifiers: async (ids) => {
      const types = await prisma.contentType.findMany({
        where: { id: { in: ids } },
        select: { id: true, identifier: true },
      });
      return new Map(types.map((t) => [t.id, t.identifier] as const));
    },
  });
}
