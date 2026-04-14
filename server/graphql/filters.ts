import type { Builder } from './builder';
import type { ContentStatusEnumRef } from './types/contentStatus';
import type { registerScoreTypes } from './types/score';

export function registerStaticFilters(
  builder: Builder,
  ContentStatusEnum: ContentStatusEnumRef,
  ScoreTypeEnum: ReturnType<typeof registerScoreTypes>['ScoreTypeEnum']
) {
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

  const ContentStatusFilter = builder.prismaFilter(ContentStatusEnum, {
    ops: ['equals', 'not'],
  });

  const ScoreTypeFilter = builder.prismaFilter(ScoreTypeEnum, {
    ops: ['equals', 'not'],
  });

  // Model where inputs
  const TeamWhere = builder.prismaWhere('Team', {
    fields: {
      entryTitle: StringFilter,
      name: StringFilter,
      slug: StringFilter,
      status: ContentStatusFilter,
    },
  });

  const ClubWhere = builder.prismaWhere('Club', {
    fields: {
      entryTitle: StringFilter,
      name: StringFilter,
      slug: StringFilter,
      status: ContentStatusFilter,
    },
  });

  const CompetitionWhere = builder.prismaWhere('Competition', {
    fields: {
      entryTitle: StringFilter,
      name: StringFilter,
      slug: StringFilter,
      status: ContentStatusFilter,
    },
  });

  const SeasonWhere = builder.prismaWhere('Season', {
    fields: {
      entryTitle: StringFilter,
      name: StringFilter,
      slug: StringFilter,
      status: ContentStatusFilter,
      startDate: DateTimeFilter,
      endDate: DateTimeFilter,
    } as never,
  });

  const PositionWhere = builder.prismaWhere('Position', {
    fields: { name: StringFilter },
  });

  const ImageWhere = builder.prismaWhere('Image', {
    fields: {
      entryTitle: StringFilter,
      url: StringFilter,
      alt: StringFilter,
      width: IntFilter,
      height: IntFilter,
      status: ContentStatusFilter,
    },
  });

  const PlayerWhere = builder.prismaWhere('Player', {
    fields: {
      entryTitle: StringFilter,
      firstName: StringFilter,
      lastName: StringFilter,
      slug: StringFilter,
      bio: StringFilter,
      status: ContentStatusFilter,
    },
  });

  // Relation filters (to-one, wraps Where with is/isNot)
  const SeasonRelationFilter = builder.inputType('SeasonRelationFilter', {
    fields: (t) => ({
      is: t.field({ type: SeasonWhere }),
      isNot: t.field({ type: SeasonWhere }),
    }),
  });

  const TeamRelationFilter = builder.inputType('TeamRelationFilter', {
    fields: (t) => ({
      is: t.field({ type: TeamWhere }),
      isNot: t.field({ type: TeamWhere }),
    }),
  });

  const ClubRelationFilter = builder.inputType('ClubRelationFilter', {
    fields: (t) => ({
      is: t.field({ type: ClubWhere }),
      isNot: t.field({ type: ClubWhere }),
    }),
  });

  const CompetitionRelationFilter = builder.inputType(
    'CompetitionRelationFilter',
    {
      fields: (t) => ({
        is: t.field({ type: CompetitionWhere }),
        isNot: t.field({ type: CompetitionWhere }),
      }),
    }
  );

  // Model where inputs (with relation filters)
  const FixtureWhere = builder.prismaWhere('Fixture', {
    fields: {
      entryTitle: StringFilter,
      name: StringFilter,
      slug: StringFilter,
      isHome: BooleanFilter,
      status: ContentStatusFilter,
      kickoff: DateTimeFilter,
      venue: StringFilter,
      team: TeamRelationFilter,
      opponent: ClubRelationFilter,
      competition: CompetitionRelationFilter,
      season: SeasonRelationFilter,
    } as never,
  });

  const PlayerTeamHistoryWhere = builder.prismaWhere('PlayerTeamHistory', {
    fields: {
      startDate: DateTimeFilter,
      endDate: DateTimeFilter,
    } as never,
  });

  const ScoreWhere = builder.prismaWhere('Score', {
    fields: {
      type: ScoreTypeFilter,
      minute: IntFilter,
    },
  });

  const AuthorWhere = builder.prismaWhere('Author', {
    fields: {
      entryTitle: StringFilter,
      name: StringFilter,
      slug: StringFilter,
      status: ContentStatusFilter,
    },
  });

  const TagGroupWhere = builder.prismaWhere('TagGroup', {
    fields: {
      entryTitle: StringFilter,
      name: StringFilter,
      slug: StringFilter,
      status: ContentStatusFilter,
    },
  });

  const TagGroupRelationFilter = builder.inputType('TagGroupRelationFilter', {
    fields: (t) => ({
      is: t.field({ type: TagGroupWhere }),
      isNot: t.field({ type: TagGroupWhere }),
    }),
  });

  const TagWhere = builder.prismaWhere('Tag', {
    fields: {
      entryTitle: StringFilter,
      name: StringFilter,
      slug: StringFilter,
      status: ContentStatusFilter,
      group: TagGroupRelationFilter,
    } as never,
  });

  // List relation filter for many-to-many Tag
  const TagListRelationFilter = builder.inputType('TagListRelationFilter', {
    fields: (t) => ({
      some: t.field({ type: TagWhere }),
      every: t.field({ type: TagWhere }),
      none: t.field({ type: TagWhere }),
    }),
  });

  const AuthorRelationFilter = builder.inputType('AuthorRelationFilter', {
    fields: (t) => ({
      is: t.field({ type: AuthorWhere }),
      isNot: t.field({ type: AuthorWhere }),
    }),
  });

  const ArticleWhere = builder.prismaWhere('Article', {
    fields: {
      entryTitle: StringFilter,
      title: StringFilter,
      slug: StringFilter,
      status: ContentStatusFilter,
      author: AuthorRelationFilter,
      tags: TagListRelationFilter,
    } as never,
  });

  const LinkWhere = builder.prismaWhere('Link', {
    fields: {
      entryTitle: StringFilter,
      label: StringFilter,
      url: StringFilter,
      status: ContentStatusFilter,
    },
  });

  const NavigationWhere = builder.prismaWhere('Navigation', {
    fields: {
      entryTitle: StringFilter,
      name: StringFilter,
      status: ContentStatusFilter,
    },
  });

  return {
    StringFilter,
    IntFilter,
    BooleanFilter,
    DateTimeFilter,
    ContentStatusFilter,
    ScoreTypeFilter,
    TeamWhere,
    ClubWhere,
    CompetitionWhere,
    SeasonWhere,
    PositionWhere,
    ImageWhere,
    PlayerWhere,
    FixtureWhere,
    PlayerTeamHistoryWhere,
    ScoreWhere,
    AuthorWhere,
    TagGroupWhere,
    TagWhere,
    ArticleWhere,
    LinkWhere,
    NavigationWhere,
  };
}

export type StaticFilterRefs = ReturnType<typeof registerStaticFilters>;
