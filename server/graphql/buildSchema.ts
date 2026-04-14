import type { GraphQLSchema } from 'graphql';
import { createBuilder } from './builder';
import { registerContentStatusEnum } from './types/contentStatus';
import { registerScoreTypes } from './types/score';
import { registerStaticFilters } from './filters';
import { registerImageType } from './types/image';
import { registerPositionType } from './types/position';
import { registerSeasonType } from './types/season';
import { registerTeamType } from './types/team';
import { registerClubType } from './types/club';
import { registerCompetitionType } from './types/competition';
import { registerPlayerTeamHistoryType } from './types/playerTeamHistory';
import { registerTeamsOnCompetitionsType } from './types/teamsOnCompetitions';
import { registerPlayerType } from './types/player';
import { registerFixtureType } from './types/fixture';
import { registerAuthorType } from './types/author';
import { registerTagGroupType } from './types/tagGroup';
import { registerTagType } from './types/tag';
import { registerArticleType } from './types/article';
import { registerLinkType } from './types/link';
import { registerNavigationItemType } from './types/navigationItem';
import { registerNavigationType } from './types/navigation';
import { registerStaticQueries } from './query/index';
import { registerDynamicTypes } from './dynamicTypes';
import { prisma } from '../utils/prisma';

export async function buildSchema(): Promise<GraphQLSchema> {
  const builder = createBuilder();

  // 1. Shared enums
  const ContentStatusEnum = registerContentStatusEnum(builder);
  const { ScoreTypeEnum } = registerScoreTypes(builder);

  // 2. Static filters
  const filters = registerStaticFilters(
    builder,
    ContentStatusEnum,
    ScoreTypeEnum
  );

  // 3. Static types (dependency order matters for ArticleRef)
  registerImageType(builder, ContentStatusEnum);
  registerPositionType(builder, filters);
  registerSeasonType(builder, filters, ContentStatusEnum);
  registerTeamType(builder, filters, ContentStatusEnum);
  registerClubType(builder, filters, ContentStatusEnum);
  registerCompetitionType(builder, filters, ContentStatusEnum);
  registerPlayerTeamHistoryType(builder);
  registerTeamsOnCompetitionsType(builder);
  registerPlayerType(builder, filters, ContentStatusEnum);
  registerFixtureType(builder, filters, ContentStatusEnum);
  registerAuthorType(builder, filters, ContentStatusEnum);
  registerTagGroupType(builder, filters, ContentStatusEnum);
  registerTagType(builder, filters, ContentStatusEnum);
  const { ArticleRef } = registerArticleType(
    builder,
    filters,
    ContentStatusEnum
  );
  registerLinkType(builder, ContentStatusEnum, ArticleRef);
  registerNavigationItemType(builder);
  registerNavigationType(builder, ContentStatusEnum);

  // 4. Static queries
  registerStaticQueries(builder, filters);

  // 5. Dynamic types
  const contentTypes = await prisma.contentType.findMany({
    include: { fields: { orderBy: { order: 'asc' } } },
  });
  registerDynamicTypes(builder, contentTypes, ContentStatusEnum);

  return builder.toSchema();
}
