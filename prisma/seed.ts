import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Positions
  const positionNames = [
    'Loosehead Prop',
    'Hooker',
    'Tighthead Prop',
    'Lock',
    'Blindside Flanker',
    'Openside Flanker',
    'Number 8',
    'Scrum-half',
    'Fly-half',
    'Inside Centre',
    'Outside Centre',
    'Left Wing',
    'Right Wing',
    'Fullback',
  ];
  const positions = [];
  for (const name of positionNames) {
    positions.push(
      await prisma.position.upsert({
        where: { name },
        update: {},
        create: { name },
      })
    );
  }

  const flyHalf = positions.find((p) => p.name === 'Fly-half')!;
  const hooker = positions.find((p) => p.name === 'Hooker')!;
  const scrumHalf = positions.find((p) => p.name === 'Scrum-half')!;
  const fullback = positions.find((p) => p.name === 'Fullback')!;
  const leftWing = positions.find((p) => p.name === 'Left Wing')!;

  // Teams
  const firstXV = await prisma.team.upsert({
    where: { name: '1st XV' },
    update: {},
    create: { name: '1st XV', status: 'PUBLISHED', publishedAt: new Date() },
  });

  const secondXV = await prisma.team.upsert({
    where: { name: '2nd XV' },
    update: {},
    create: { name: '2nd XV', status: 'PUBLISHED', publishedAt: new Date() },
  });

  const _veterans = await prisma.team.upsert({
    where: { name: 'Veterans' },
    update: {},
    create: { name: 'Veterans', status: 'PUBLISHED', publishedAt: new Date() },
  });

  const _colts = await prisma.team.upsert({
    where: { name: 'Colts' },
    update: {},
    create: { name: 'Colts', status: 'PUBLISHED', publishedAt: new Date() },
  });

  // Clubs (opponents)
  const oakdale = await prisma.club.upsert({
    where: { name: 'Oakdale RFC' },
    update: {},
    create: {
      name: 'Oakdale RFC',
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  const riverside = await prisma.club.upsert({
    where: { name: 'Riverside RFC' },
    update: {},
    create: {
      name: 'Riverside RFC',
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  const hilltop = await prisma.club.upsert({
    where: { name: 'Hilltop RFC' },
    update: {},
    create: {
      name: 'Hilltop RFC',
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  // Season
  const season = await prisma.season.upsert({
    where: { name: '2025/26' },
    update: {},
    create: {
      name: '2025/26',
      startDate: new Date('2025-09-01'),
      endDate: new Date('2026-05-31'),
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  // Competitions
  const league = await prisma.competition.upsert({
    where: { name: 'Division 1' },
    update: {},
    create: {
      name: 'Division 1',
      seasonId: season.id,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  const cup = await prisma.competition.upsert({
    where: { name: 'County Cup' },
    update: {},
    create: {
      name: 'County Cup',
      seasonId: season.id,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  // Link teams to competitions
  await prisma.teamsOnCompetitions.upsert({
    where: {
      teamId_competitionId: {
        teamId: firstXV.id,
        competitionId: league.id,
      },
    },
    update: {},
    create: { teamId: firstXV.id, competitionId: league.id },
  });

  await prisma.teamsOnCompetitions.upsert({
    where: {
      teamId_competitionId: {
        teamId: firstXV.id,
        competitionId: cup.id,
      },
    },
    update: {},
    create: { teamId: firstXV.id, competitionId: cup.id },
  });

  // Players
  const jones = await prisma.player.create({
    data: {
      firstName: 'Rhys',
      lastName: 'Jones',
      positionId: flyHalf.id,
      bio: 'Club captain and first-choice fly-half.',
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  const williams = await prisma.player.create({
    data: {
      firstName: 'Dai',
      lastName: 'Williams',
      positionId: hooker.id,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  const evans = await prisma.player.create({
    data: {
      firstName: 'Tom',
      lastName: 'Evans',
      positionId: scrumHalf.id,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  const morgan = await prisma.player.create({
    data: {
      firstName: 'Owen',
      lastName: 'Morgan',
      positionId: fullback.id,
      bio: 'Versatile back, covers fullback and wing.',
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  const price = await prisma.player.create({
    data: {
      firstName: 'Gethin',
      lastName: 'Price',
      positionId: leftWing.id,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  // Player team history
  for (const data of [
    {
      playerId: jones.id,
      teamId: firstXV.id,
      startDate: new Date('2023-09-01'),
    },
    {
      playerId: williams.id,
      teamId: firstXV.id,
      startDate: new Date('2024-09-01'),
    },
    {
      playerId: evans.id,
      teamId: firstXV.id,
      startDate: new Date('2025-09-01'),
    },
    {
      playerId: evans.id,
      teamId: secondXV.id,
      startDate: new Date('2023-09-01'),
      endDate: new Date('2025-08-31'),
    },
    {
      playerId: morgan.id,
      teamId: firstXV.id,
      startDate: new Date('2025-09-01'),
    },
    {
      playerId: price.id,
      teamId: secondXV.id,
      startDate: new Date('2025-09-01'),
    },
  ]) {
    await prisma.playerTeamHistory.create({ data });
  }

  // Fixtures
  const fixture1 = await prisma.fixture.create({
    data: {
      name: '1st XV vs Oakdale RFC',
      teamId: firstXV.id,
      opponentId: oakdale.id,
      competitionId: league.id,
      seasonId: season.id,
      isHome: true,
      kickoff: new Date('2025-09-13T14:30:00'),
      venue: 'Home Ground',
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  const fixture2 = await prisma.fixture.create({
    data: {
      name: 'Riverside RFC vs 1st XV',
      teamId: firstXV.id,
      opponentId: riverside.id,
      competitionId: league.id,
      seasonId: season.id,
      isHome: false,
      kickoff: new Date('2025-09-20T15:00:00'),
      venue: 'Riverside Park',
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  await prisma.fixture.create({
    data: {
      name: '1st XV vs Hilltop RFC (Cup)',
      teamId: firstXV.id,
      opponentId: hilltop.id,
      competitionId: cup.id,
      seasonId: season.id,
      isHome: true,
      kickoff: new Date('2025-10-04T14:30:00'),
      venue: 'Home Ground',
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  // Scores for fixture 1 (home win 24-12)
  for (const data of [
    {
      fixtureId: fixture1.id,
      playerId: jones.id,
      type: 'TRY' as const,
      minute: 12,
    },
    {
      fixtureId: fixture1.id,
      playerId: jones.id,
      type: 'CONVERSION' as const,
      minute: 13,
    },
    {
      fixtureId: fixture1.id,
      playerId: morgan.id,
      type: 'TRY' as const,
      minute: 28,
    },
    {
      fixtureId: fixture1.id,
      playerId: jones.id,
      type: 'CONVERSION' as const,
      minute: 29,
    },
    {
      fixtureId: fixture1.id,
      playerId: jones.id,
      type: 'PENALTY' as const,
      minute: 55,
    },
    {
      fixtureId: fixture1.id,
      playerId: evans.id,
      type: 'TRY' as const,
      minute: 72,
    },
  ]) {
    await prisma.score.create({ data });
  }

  // Scores for fixture 2 (away loss 10-17)
  for (const data of [
    {
      fixtureId: fixture2.id,
      playerId: price.id,
      type: 'TRY' as const,
      minute: 35,
    },
    {
      fixtureId: fixture2.id,
      playerId: jones.id,
      type: 'CONVERSION' as const,
      minute: 36,
    },
    {
      fixtureId: fixture2.id,
      playerId: jones.id,
      type: 'PENALTY' as const,
      minute: 68,
    },
  ]) {
    await prisma.score.create({ data });
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
