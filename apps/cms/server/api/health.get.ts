export default defineEventHandler(async () => {
  // DB is essential: a failed query throws → 500, preserving the existing
  // liveness contract (orchestrators recycle the container if the DB is gone).
  await prisma.$queryRaw`SELECT 1`;

  // Search is non-essential: report reachability as a sub-field but never fail
  // the probe on a Meilisearch outage (graceful degradation — mirrors the
  // search epic's no-fallback stance). checkMeiliHealth is auto-imported from
  // server/utils and never throws.
  const searchAvailable = await checkMeiliHealth();

  return {
    status: 'ok',
    database: 'connected',
    search: searchAvailable ? 'available' : 'unavailable',
  };
});
