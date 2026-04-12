import { assertUuid, assertNonNegativeInt } from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';

const MAX_REORDER_ITEMS = 500;

interface ReorderItem {
  id: string;
  order: number;
  parentId: string | null;
}

export default defineEventHandler(async (event) => {
  enforceMutationRateLimit(event, 'navigation-items.reorder');
  const body = await readBody<{
    navigationId?: unknown;
    items?: unknown;
  }>(event);

  const navigationId = assertUuid(body.navigationId, 'navigationId');

  if (!Array.isArray(body.items)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'items array is required',
    });
  }

  if (body.items.length > MAX_REORDER_ITEMS) {
    throw createError({
      statusCode: 400,
      statusMessage: `items array exceeds max size of ${MAX_REORDER_ITEMS}`,
    });
  }

  const validated: ReorderItem[] = body.items.map((raw, idx) => {
    if (typeof raw !== 'object' || raw === null) {
      throw createError({
        statusCode: 400,
        statusMessage: `items[${idx}] must be an object`,
      });
    }
    const item = raw as Record<string, unknown>;
    const id = assertUuid(item.id, `items[${idx}].id`);
    const order = assertNonNegativeInt(item.order, `items[${idx}].order`);

    let parentId: string | null = null;
    if (item.parentId != null && item.parentId !== '') {
      parentId = assertUuid(item.parentId, `items[${idx}].parentId`);
      if (parentId === id) {
        throw createError({
          statusCode: 400,
          statusMessage: `items[${idx}] cannot be its own parent`,
        });
      }
    }

    return { id, order, parentId };
  });

  // H1: all items must belong to the declared navigation. Look up the
  // set of item IDs that actually belong to this navigation in one query;
  // reject if any submitted ID is missing from that set.
  const ids = validated.map((i) => i.id);
  const existing = await prisma.navigationItem.findMany({
    where: { id: { in: ids }, navigationId },
    select: { id: true },
  });
  if (existing.length !== ids.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'one or more items do not belong to the given navigation',
    });
  }

  // Validate that every parentId in the batch also belongs to the
  // same navigation (prevents cross-nav reparenting mid-batch).
  const parentIds = Array.from(
    new Set(
      validated
        .map((i) => i.parentId)
        .filter((p): p is string => typeof p === 'string')
    )
  );
  if (parentIds.length > 0) {
    const parents = await prisma.navigationItem.findMany({
      where: { id: { in: parentIds }, navigationId },
      select: { id: true, parentId: true },
    });
    if (parents.length !== parentIds.length) {
      throw createError({
        statusCode: 400,
        statusMessage:
          'one or more parentIds do not belong to the given navigation',
      });
    }
    // Two-level depth rule: a parent cannot itself be a child.
    if (parents.some((p) => p.parentId !== null)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Cannot nest more than two levels deep',
      });
    }
  }

  const updated = await withPrismaErrors(() =>
    prisma.$transaction(
      validated.map((item) =>
        prisma.navigationItem.update({
          where: { id: item.id },
          data: { order: item.order, parentId: item.parentId },
        })
      )
    )
  );

  return updated;
});
