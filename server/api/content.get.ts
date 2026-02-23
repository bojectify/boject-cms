export default defineEventHandler(async () => {
  const [teams, players, fixtures, clubs, competitions, seasons, images] =
    await Promise.all([
      prisma.team.findMany(),
      prisma.player.findMany(),
      prisma.fixture.findMany(),
      prisma.club.findMany(),
      prisma.competition.findMany(),
      prisma.season.findMany(),
      prisma.image.findMany(),
    ]);

  const entries = [
    ...teams.map((e) => ({ ...e, contentType: 'Team' })),
    ...players.map((e) => ({ ...e, contentType: 'Player' })),
    ...fixtures.map((e) => ({ ...e, contentType: 'Fixture' })),
    ...clubs.map((e) => ({ ...e, contentType: 'Club' })),
    ...competitions.map((e) => ({ ...e, contentType: 'Competition' })),
    ...seasons.map((e) => ({ ...e, contentType: 'Season' })),
    ...images.map((e) => ({ ...e, contentType: 'Image' })),
  ];

  return entries
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
    .slice(0, 40);
});
