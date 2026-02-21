import { builder } from './builder';
import { ScoreTypeEnum } from './types/score';

// Scalar filters
const StringFilter = builder.prismaFilter('String', {
  ops: ['contains', 'equals', 'startsWith', 'endsWith', 'not'],
});

const IntFilter = builder.prismaFilter('Int', {
  ops: ['equals', 'gt', 'gte', 'lt', 'lte', 'not'],
});

const BooleanFilter = builder.prismaFilter('Boolean', {
  ops: ['equals', 'not'],
});

const DateTimeFilter = builder.prismaFilter('DateTime', {
  ops: ['equals', 'gt', 'gte', 'lt', 'lte', 'not'],
});

const ScoreTypeFilter = builder.prismaFilter(ScoreTypeEnum, {
  ops: ['equals', 'not'],
});

// Model where inputs
export const TeamWhere = builder.prismaWhere('Team', {
  fields: { name: StringFilter },
});

export const ClubWhere = builder.prismaWhere('Club', {
  fields: { name: StringFilter },
});

export const CompetitionWhere = builder.prismaWhere('Competition', {
  fields: { name: StringFilter },
});

export const SeasonWhere = builder.prismaWhere('Season', {
  fields: {
    name: StringFilter,
    startDate: DateTimeFilter,
    endDate: DateTimeFilter,
  } as never,
});

export const PositionWhere = builder.prismaWhere('Position', {
  fields: { name: StringFilter },
});

export const ImageWhere = builder.prismaWhere('Image', {
  fields: {
    url: StringFilter,
    alt: StringFilter,
    width: IntFilter,
    height: IntFilter,
  },
});

export const PlayerWhere = builder.prismaWhere('Player', {
  fields: {
    firstName: StringFilter,
    lastName: StringFilter,
    bio: StringFilter,
  },
});

export const FixtureWhere = builder.prismaWhere('Fixture', {
  fields: {
    name: StringFilter,
    isHome: BooleanFilter,
    kickoff: DateTimeFilter,
    venue: StringFilter,
  } as never,
});

export const ScoreWhere = builder.prismaWhere('Score', {
  fields: {
    type: ScoreTypeFilter,
    minute: IntFilter,
  },
});

export const _registered = true;
