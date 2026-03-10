import 'dotenv/config';
import {
  createHash,
  randomBytes,
  scrypt as scryptCb,
  type ScryptOptions,
} from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keyLength, options, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

/**
 * Hash a password into PHC format compatible with @adonisjs/hash Scrypt driver.
 * Format: $scrypt$n=16384,r=8,p=1$<salt_b64>$<hash_b64>
 */
async function hashPasswordForSeed(password: string): Promise<string> {
  const n = 16384;
  const r = 8;
  const p = 1;
  const keyLength = 64;
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, keyLength, {
    cost: n,
    blockSize: r,
    parallelization: p,
    maxmem: 32 * 1024 * 1024,
  });
  const saltB64 = salt.toString('base64').replace(/=+$/, '');
  const hashB64 = derived.toString('base64').replace(/=+$/, '');
  return `$scrypt$n=${n},r=${r},p=${p}$${saltB64}$${hashB64}`;
}

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
    create: {
      name: '1st XV',
      slug: '1st-xv',
      entryTitle: '1st XV',
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  const secondXV = await prisma.team.upsert({
    where: { name: '2nd XV' },
    update: {},
    create: {
      name: '2nd XV',
      slug: '2nd-xv',
      entryTitle: '2nd XV',
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  const _veterans = await prisma.team.upsert({
    where: { name: 'Veterans' },
    update: {},
    create: {
      name: 'Veterans',
      slug: 'veterans',
      entryTitle: 'Veterans',
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  const _colts = await prisma.team.upsert({
    where: { name: 'Colts' },
    update: {},
    create: {
      name: 'Colts',
      slug: 'colts',
      entryTitle: 'Colts',
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  // Admin user
  const hashedPassword = await hashPasswordForSeed('password');
  await prisma.user.upsert({
    where: { email: 'admin@boject.com' },
    update: { firstName: 'Admin', lastName: 'User' },
    create: {
      email: 'admin@boject.com',
      password: hashedPassword,
      firstName: 'Admin',
      lastName: 'User',
    },
  });

  // Clubs (opponents)
  const oakdale = await prisma.club.upsert({
    where: { name: 'Oakdale RFC' },
    update: {},
    create: {
      name: 'Oakdale RFC',
      slug: 'oakdale-rfc',
      entryTitle: 'Oakdale RFC',
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  const riverside = await prisma.club.upsert({
    where: { name: 'Riverside RFC' },
    update: {},
    create: {
      name: 'Riverside RFC',
      slug: 'riverside-rfc',
      entryTitle: 'Riverside RFC',
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  const hilltop = await prisma.club.upsert({
    where: { name: 'Hilltop RFC' },
    update: {},
    create: {
      name: 'Hilltop RFC',
      slug: 'hilltop-rfc',
      entryTitle: 'Hilltop RFC',
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
      slug: '2025-26',
      entryTitle: '2025/26',
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
      slug: 'division-1',
      entryTitle: 'Division 1',
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
      slug: 'county-cup',
      entryTitle: 'County Cup',
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
      slug: 'rhys-jones',
      entryTitle: 'Rhys Jones',
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
      slug: 'dai-williams',
      entryTitle: 'Dai Williams',
      positionId: hooker.id,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  const evans = await prisma.player.create({
    data: {
      firstName: 'Tom',
      lastName: 'Evans',
      slug: 'tom-evans',
      entryTitle: 'Tom Evans',
      positionId: scrumHalf.id,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  const morgan = await prisma.player.create({
    data: {
      firstName: 'Owen',
      lastName: 'Morgan',
      slug: 'owen-morgan',
      entryTitle: 'Owen Morgan',
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
      slug: 'gethin-price',
      entryTitle: 'Gethin Price',
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
      slug: '1st-xv-vs-oakdale-rfc',
      entryTitle: '1st XV vs Oakdale RFC',
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
      slug: 'riverside-rfc-vs-1st-xv',
      entryTitle: 'Riverside RFC vs 1st XV',
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
      slug: '1st-xv-vs-hilltop-rfc-cup',
      entryTitle: '1st XV vs Hilltop RFC (Cup)',
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

  // Test API key (deterministic, for integration tests only)
  const testKey = 'boject_test_key_for_integration_tests_only';
  const testKeyHash = createHash('sha256').update(testKey).digest('hex');
  await prisma.apiKey.upsert({
    where: { keyHash: testKeyHash },
    update: {},
    create: {
      name: 'Integration Tests',
      keyHash: testKeyHash,
      keyPrefix: testKey.slice(0, 11),
    },
  });

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
