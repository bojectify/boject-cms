import { describe, it, expect, beforeEach } from 'vitest';
import { runCleanup } from './webhookCleanup';

describe('runCleanup', () => {
  const now = new Date('2026-04-22T12:00:00Z');

  type Row = {
    id: string;
    status: string;
    createdAt: Date;
    completedAt: Date | null;
  };

  let rows: Row[];

  beforeEach(() => {
    rows = [
      {
        id: 'old-success',
        status: 'SUCCESS',
        createdAt: new Date('2026-03-01'),
        completedAt: new Date('2026-03-01'),
      },
      {
        id: 'recent-success',
        status: 'SUCCESS',
        createdAt: new Date('2026-04-20'),
        completedAt: new Date('2026-04-20'),
      },
      {
        id: 'old-dead',
        status: 'DEAD_LETTERED',
        createdAt: new Date('2026-02-01'),
        completedAt: null,
      },
      {
        id: 'recent-dead',
        status: 'DEAD_LETTERED',
        createdAt: new Date('2026-04-10'),
        completedAt: null,
      },
    ];
  });

  it('deletes SUCCESS rows older than 30 days by completedAt', async () => {
    const prisma = {
      webhookDelivery: {
        deleteMany: async ({ where }: { where: unknown }) => {
          const before = rows.length;
          rows = rows.filter((r) => !matches(r, where));
          return { count: before - rows.length };
        },
      },
    };
    await runCleanup({ prisma: prisma as never, now: () => now });
    expect(rows.map((r) => r.id).sort()).toEqual(
      ['recent-dead', 'recent-success'].sort()
    );
  });
});

// trivial matcher for the deleteMany call
function matches(
  row: { status: string; createdAt: Date; completedAt: Date | null },
  where: unknown
): boolean {
  const w = where as {
    OR: Array<{
      completedAt?: { lt: Date };
      AND?: Array<{ status?: string; createdAt?: { lt: Date } }>;
    }>;
  };
  return w.OR.some((clause) => {
    if (
      clause.completedAt &&
      row.completedAt &&
      row.completedAt < clause.completedAt.lt
    ) {
      return true;
    }
    if (clause.AND) {
      const [statusClause, dateClause] = clause.AND;
      if (
        row.status === statusClause?.status &&
        dateClause?.createdAt &&
        row.createdAt < dateClause.createdAt.lt
      ) {
        return true;
      }
    }
    return false;
  });
}
