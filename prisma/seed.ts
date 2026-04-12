import 'dotenv/config';
import {
  createHash,
  randomBytes,
  scrypt as scryptCb,
  type ScryptOptions,
} from 'node:crypto';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
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

  // Seed image — copy placeholder to storage and create DB record
  const storageDir = join(
    import.meta.dirname,
    '..',
    'storage',
    'images',
    'originals'
  );
  mkdirSync(storageDir, { recursive: true });
  const srcImage = join(
    import.meta.dirname,
    '..',
    'assets',
    'images',
    'placeholder-hero.png'
  );
  const storageKey = 'seed-placeholder-hero.png';
  copyFileSync(srcImage, join(storageDir, storageKey));
  const { size: fileSize } = statSync(srcImage);

  await prisma.image.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      entryTitle: 'Placeholder Hero',
      url: '/api/images/00000000-0000-0000-0000-000000000001/transform',
      alt: 'Placeholder hero image',
      width: 1920,
      height: 663,
      storagePath: storageKey,
      mimeType: 'image/png',
      fileSize,
      originalName: 'placeholder-hero.png',
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
  const jones = await prisma.player.upsert({
    where: { slug: 'rhys-jones' },
    update: {},
    create: {
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

  const williams = await prisma.player.upsert({
    where: { slug: 'dai-williams' },
    update: {},
    create: {
      firstName: 'Dai',
      lastName: 'Williams',
      slug: 'dai-williams',
      entryTitle: 'Dai Williams',
      positionId: hooker.id,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  const evans = await prisma.player.upsert({
    where: { slug: 'tom-evans' },
    update: {},
    create: {
      firstName: 'Tom',
      lastName: 'Evans',
      slug: 'tom-evans',
      entryTitle: 'Tom Evans',
      positionId: scrumHalf.id,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  const morgan = await prisma.player.upsert({
    where: { slug: 'owen-morgan' },
    update: {},
    create: {
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

  const price = await prisma.player.upsert({
    where: { slug: 'gethin-price' },
    update: {},
    create: {
      firstName: 'Gethin',
      lastName: 'Price',
      slug: 'gethin-price',
      entryTitle: 'Gethin Price',
      positionId: leftWing.id,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  // Player team history — clear existing for seeded players, then recreate
  const seededPlayerIds = [
    jones.id,
    williams.id,
    evans.id,
    morgan.id,
    price.id,
  ];
  await prisma.playerTeamHistory.deleteMany({
    where: { playerId: { in: seededPlayerIds } },
  });
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
  const fixture1 = await prisma.fixture.upsert({
    where: { slug: '1st-xv-vs-oakdale-rfc' },
    update: {},
    create: {
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

  const fixture2 = await prisma.fixture.upsert({
    where: { slug: 'riverside-rfc-vs-1st-xv' },
    update: {},
    create: {
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

  await prisma.fixture.upsert({
    where: { slug: '1st-xv-vs-hilltop-rfc-cup' },
    update: {},
    create: {
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

  // Scores — clear existing for seeded fixtures, then recreate
  await prisma.score.deleteMany({
    where: { fixtureId: { in: [fixture1.id, fixture2.id] } },
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

  // Authors
  const authorJones = await prisma.author.upsert({
    where: { name: 'Gareth Jones' },
    update: {},
    create: {
      name: 'Gareth Jones',
      slug: 'gareth-jones',
      entryTitle: 'Gareth Jones',
      bio: 'Club press officer and match report writer.',
      status: 'PUBLISHED',
      publishedAt: new Date(),
      socialLinks: {
        create: [
          { platform: 'twitter', url: 'https://twitter.com/garethjones' },
          { platform: 'instagram', url: 'https://instagram.com/garethjones' },
        ],
      },
    },
  });

  const authorDavies = await prisma.author.upsert({
    where: { name: 'Sarah Davies' },
    update: {},
    create: {
      name: 'Sarah Davies',
      slug: 'sarah-davies',
      entryTitle: 'Sarah Davies',
      bio: 'Youth development coordinator.',
      status: 'PUBLISHED',
      publishedAt: new Date(),
      socialLinks: {
        create: [
          { platform: 'linkedin', url: 'https://linkedin.com/in/sarahdavies' },
        ],
      },
    },
  });

  // Tag Groups
  const groupMatchType = await prisma.tagGroup.upsert({
    where: { name: 'Match Type' },
    update: {},
    create: {
      name: 'Match Type',
      slug: 'match-type',
      entryTitle: 'Match Type',
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  const groupTopic = await prisma.tagGroup.upsert({
    where: { name: 'Topic' },
    update: {},
    create: {
      name: 'Topic',
      slug: 'topic',
      entryTitle: 'Topic',
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  // Tags
  const tagMatchReport = await prisma.tag.upsert({
    where: { name: 'Match Report' },
    update: { groupId: groupMatchType.id },
    create: {
      name: 'Match Report',
      slug: 'match-report',
      entryTitle: 'Match Report',
      groupId: groupMatchType.id,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  const tagClubNews = await prisma.tag.upsert({
    where: { name: 'Club News' },
    update: { groupId: groupTopic.id },
    create: {
      name: 'Club News',
      slug: 'club-news',
      entryTitle: 'Club News',
      groupId: groupTopic.id,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  const tagYouth = await prisma.tag.upsert({
    where: { name: 'Youth' },
    update: { groupId: groupTopic.id },
    create: {
      name: 'Youth',
      slug: 'youth',
      entryTitle: 'Youth',
      groupId: groupTopic.id,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  // Articles
  await prisma.article.upsert({
    where: { title: 'Opening Day Victory' },
    update: {},
    create: {
      title: 'Opening Day Victory',
      slug: 'opening-day-victory',
      entryTitle: 'Opening Day Victory',
      summary: 'A commanding performance from the 1st XV in the season opener.',
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'The 1st XV kicked off the season with a convincing home win against Oakdale RFC.',
              },
            ],
          },
        ],
      },
      authorId: authorJones.id,
      tags: { connect: [{ id: tagMatchReport.id }] },
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  await prisma.article.upsert({
    where: { title: 'Youth Programme Expands' },
    update: {},
    create: {
      title: 'Youth Programme Expands',
      slug: 'youth-programme-expands',
      entryTitle: 'Youth Programme Expands',
      summary: 'New age groups added to the junior section for 2025/26.',
      authorId: authorDavies.id,
      tags: { connect: [{ id: tagClubNews.id }, { id: tagYouth.id }] },
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  await prisma.article.upsert({
    where: { title: 'Draft: Season Preview' },
    update: {},
    create: {
      title: 'Draft: Season Preview',
      slug: 'draft-season-preview',
      entryTitle: 'Draft: Season Preview',
      summary: 'Looking ahead to the 2025/26 campaign.',
      authorId: authorJones.id,
      tags: { connect: [{ id: tagClubNews.id }] },
      status: 'DRAFT',
    },
  });

  // Links
  const linkHome = await prisma.link.upsert({
    where: { id: '00000000-0000-0000-0000-000000000100' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000100',
      entryTitle: 'Home',
      label: 'Home',
      url: '/',
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  const linkArticles = await prisma.link.upsert({
    where: { id: '00000000-0000-0000-0000-000000000101' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000101',
      entryTitle: 'Articles',
      label: 'Articles',
      url: '/articles',
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  // Look up an article to link to
  const openingDayArticle = await prisma.article.findUnique({
    where: { title: 'Opening Day Victory' },
  });

  const linkOpeningDay = await prisma.link.upsert({
    where: { id: '00000000-0000-0000-0000-000000000102' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000102',
      entryTitle: 'Opening Day Victory',
      label: 'Opening Day Victory',
      articleId: openingDayArticle?.id ?? null,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  const linkYouthProgramme = await prisma.link.upsert({
    where: { id: '00000000-0000-0000-0000-000000000103' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000103',
      entryTitle: 'Youth Programme',
      label: 'Youth Programme',
      url: '/youth',
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  const linkContact = await prisma.link.upsert({
    where: { id: '00000000-0000-0000-0000-000000000104' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000104',
      entryTitle: 'Contact Us',
      label: 'Contact Us',
      url: '/contact',
      openInNewTab: false,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  const linkExternal = await prisma.link.upsert({
    where: { id: '00000000-0000-0000-0000-000000000105' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000105',
      entryTitle: 'WRU Website',
      label: 'WRU',
      url: 'https://www.wru.wales',
      openInNewTab: true,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  // Navigation
  const mainNav = await prisma.navigation.upsert({
    where: { name: 'Main Navigation' },
    update: {},
    create: {
      name: 'Main Navigation',
      entryTitle: 'Main Navigation',
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  // Clear existing navigation items for this nav, then recreate
  await prisma.navigationItem.deleteMany({
    where: { navigationId: mainNav.id },
  });

  // Top-level items
  await prisma.navigationItem.create({
    data: {
      navigationId: mainNav.id,
      linkId: linkHome.id,
      order: 0,
    },
  });

  const navItemArticles = await prisma.navigationItem.create({
    data: {
      navigationId: mainNav.id,
      linkId: linkArticles.id,
      order: 1,
    },
  });

  await prisma.navigationItem.create({
    data: {
      navigationId: mainNav.id,
      linkId: linkContact.id,
      order: 2,
    },
  });

  await prisma.navigationItem.create({
    data: {
      navigationId: mainNav.id,
      linkId: linkExternal.id,
      order: 3,
    },
  });

  // Sub-links under Articles
  await prisma.navigationItem.create({
    data: {
      navigationId: mainNav.id,
      linkId: linkOpeningDay.id,
      parentId: navItemArticles.id,
      order: 0,
    },
  });

  await prisma.navigationItem.create({
    data: {
      navigationId: mainNav.id,
      linkId: linkYouthProgramme.id,
      parentId: navItemArticles.id,
      order: 1,
    },
  });

  // Test API key (deterministic, for integration tests only)
  if (process.env.NODE_ENV !== 'production') {
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
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
