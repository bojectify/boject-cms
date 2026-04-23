import type { PrismaClient } from '#prisma';

const RETENTION_DAYS = 30;

export interface CleanupDeps {
  prisma: Pick<PrismaClient, 'webhookDelivery'>;
  now: () => Date;
}

export async function runCleanup(deps: CleanupDeps): Promise<number> {
  const cutoff = new Date(
    deps.now().getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  );
  const result = await deps.prisma.webhookDelivery.deleteMany({
    where: {
      OR: [
        { completedAt: { lt: cutoff } },
        { AND: [{ status: 'DEAD_LETTERED' }, { createdAt: { lt: cutoff } }] },
      ],
    },
  });
  return result.count;
}
