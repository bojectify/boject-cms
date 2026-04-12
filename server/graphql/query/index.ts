import { builder } from '../builder';
import { prisma } from '../../utils/prisma';
import {
  ImageWhere,
  PositionWhere,
  SeasonWhere,
  TeamWhere,
  ClubWhere,
  CompetitionWhere,
  PlayerWhere,
  FixtureWhere,
  ScoreWhere,
  AuthorWhere,
  TagGroupWhere,
  TagWhere,
  ArticleWhere,
  LinkWhere,
  NavigationWhere,
} from '../filters';

builder.queryType({
  fields: (t) => ({
    // Image
    images: t.prismaConnection({
      type: 'Image',
      cursor: 'id',
      args: { where: t.arg({ type: ImageWhere }) },
      resolve: (query, _root, args) =>
        prisma.image.findMany({ ...query, where: args.where ?? undefined }),
    }),
    image: t.prismaField({
      type: 'Image',
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: (query, _root, args) =>
        prisma.image.findUnique({ ...query, where: { id: args.id } }),
    }),

    // Position
    positions: t.prismaConnection({
      type: 'Position',
      cursor: 'id',
      args: { where: t.arg({ type: PositionWhere }) },
      resolve: (query, _root, args) =>
        prisma.position.findMany({
          ...query,
          where: args.where ?? undefined,
        }),
    }),
    position: t.prismaField({
      type: 'Position',
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: (query, _root, args) =>
        prisma.position.findUnique({ ...query, where: { id: args.id } }),
    }),

    // Season
    seasons: t.prismaConnection({
      type: 'Season',
      cursor: 'id',
      args: { where: t.arg({ type: SeasonWhere }) },
      resolve: (query, _root, args) =>
        prisma.season.findMany({ ...query, where: args.where ?? undefined }),
    }),
    season: t.prismaField({
      type: 'Season',
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: (query, _root, args) =>
        prisma.season.findUnique({ ...query, where: { id: args.id } }),
    }),

    // Team
    teams: t.prismaConnection({
      type: 'Team',
      cursor: 'id',
      args: { where: t.arg({ type: TeamWhere }) },
      resolve: (query, _root, args) =>
        prisma.team.findMany({ ...query, where: args.where ?? undefined }),
    }),
    team: t.prismaField({
      type: 'Team',
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: (query, _root, args) =>
        prisma.team.findUnique({ ...query, where: { id: args.id } }),
    }),

    // Club
    clubs: t.prismaConnection({
      type: 'Club',
      cursor: 'id',
      args: { where: t.arg({ type: ClubWhere }) },
      resolve: (query, _root, args) =>
        prisma.club.findMany({ ...query, where: args.where ?? undefined }),
    }),
    club: t.prismaField({
      type: 'Club',
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: (query, _root, args) =>
        prisma.club.findUnique({ ...query, where: { id: args.id } }),
    }),

    // Competition
    competitions: t.prismaConnection({
      type: 'Competition',
      cursor: 'id',
      args: { where: t.arg({ type: CompetitionWhere }) },
      resolve: (query, _root, args) =>
        prisma.competition.findMany({
          ...query,
          where: args.where ?? undefined,
        }),
    }),
    competition: t.prismaField({
      type: 'Competition',
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: (query, _root, args) =>
        prisma.competition.findUnique({ ...query, where: { id: args.id } }),
    }),

    // Player
    players: t.prismaConnection({
      type: 'Player',
      cursor: 'id',
      args: { where: t.arg({ type: PlayerWhere }) },
      resolve: (query, _root, args) =>
        prisma.player.findMany({ ...query, where: args.where ?? undefined }),
    }),
    player: t.prismaField({
      type: 'Player',
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: (query, _root, args) =>
        prisma.player.findUnique({ ...query, where: { id: args.id } }),
    }),

    // Fixture
    fixtures: t.prismaConnection({
      type: 'Fixture',
      cursor: 'id',
      args: { where: t.arg({ type: FixtureWhere }) },
      resolve: (query, _root, args) =>
        prisma.fixture.findMany({ ...query, where: args.where ?? undefined }),
    }),
    fixture: t.prismaField({
      type: 'Fixture',
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: (query, _root, args) =>
        prisma.fixture.findUnique({ ...query, where: { id: args.id } }),
    }),

    // Score
    scores: t.prismaConnection({
      type: 'Score',
      cursor: 'id',
      args: { where: t.arg({ type: ScoreWhere }) },
      resolve: (query, _root, args) =>
        prisma.score.findMany({ ...query, where: args.where ?? undefined }),
    }),
    score: t.prismaField({
      type: 'Score',
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: (query, _root, args) =>
        prisma.score.findUnique({ ...query, where: { id: args.id } }),
    }),

    // Author
    authors: t.prismaConnection({
      type: 'Author',
      cursor: 'id',
      args: { where: t.arg({ type: AuthorWhere }) },
      resolve: (query, _root, args) =>
        prisma.author.findMany({ ...query, where: args.where ?? undefined }),
    }),
    author: t.prismaField({
      type: 'Author',
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: (query, _root, args) =>
        prisma.author.findUnique({ ...query, where: { id: args.id } }),
    }),

    // TagGroup
    tagGroups: t.prismaConnection({
      type: 'TagGroup',
      cursor: 'id',
      args: { where: t.arg({ type: TagGroupWhere }) },
      resolve: (query, _root, args) =>
        prisma.tagGroup.findMany({
          ...query,
          where: args.where ?? undefined,
        }),
    }),
    tagGroup: t.prismaField({
      type: 'TagGroup',
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: (query, _root, args) =>
        prisma.tagGroup.findUnique({ ...query, where: { id: args.id } }),
    }),

    // Tag
    tags: t.prismaConnection({
      type: 'Tag',
      cursor: 'id',
      args: { where: t.arg({ type: TagWhere }) },
      resolve: (query, _root, args) =>
        prisma.tag.findMany({ ...query, where: args.where ?? undefined }),
    }),
    tag: t.prismaField({
      type: 'Tag',
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: (query, _root, args) =>
        prisma.tag.findUnique({ ...query, where: { id: args.id } }),
    }),

    // Article
    articles: t.prismaConnection({
      type: 'Article',
      cursor: 'id',
      args: { where: t.arg({ type: ArticleWhere }) },
      resolve: (query, _root, args) =>
        prisma.article.findMany({
          ...query,
          where: args.where ?? undefined,
        }),
    }),
    article: t.prismaField({
      type: 'Article',
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: (query, _root, args) =>
        prisma.article.findUnique({ ...query, where: { id: args.id } }),
    }),

    // Link
    links: t.prismaConnection({
      type: 'Link',
      cursor: 'id',
      args: { where: t.arg({ type: LinkWhere }) },
      resolve: (query, _root, args) =>
        prisma.link.findMany({ ...query, where: args.where ?? undefined }),
    }),
    link: t.prismaField({
      type: 'Link',
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: (query, _root, args) =>
        prisma.link.findUnique({ ...query, where: { id: args.id } }),
    }),

    // Navigation
    navigations: t.prismaConnection({
      type: 'Navigation',
      cursor: 'id',
      args: { where: t.arg({ type: NavigationWhere }) },
      resolve: (query, _root, args) =>
        prisma.navigation.findMany({
          ...query,
          where: args.where ?? undefined,
        }),
    }),
    navigation: t.prismaField({
      type: 'Navigation',
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: (query, _root, args) =>
        prisma.navigation.findUnique({ ...query, where: { id: args.id } }),
    }),
  }),
});

export const _registered = true;
