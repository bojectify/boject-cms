
-- DropForeignKey
ALTER TABLE "Article" DROP CONSTRAINT "Article_authorId_fkey";

-- DropForeignKey
ALTER TABLE "Article" DROP CONSTRAINT "Article_featuredImageId_fkey";

-- DropForeignKey
ALTER TABLE "Author" DROP CONSTRAINT "Author_headshotId_fkey";

-- DropForeignKey
ALTER TABLE "AuthorSocialLink" DROP CONSTRAINT "AuthorSocialLink_authorId_fkey";

-- DropForeignKey
ALTER TABLE "Club" DROP CONSTRAINT "Club_crestId_fkey";

-- DropForeignKey
ALTER TABLE "Competition" DROP CONSTRAINT "Competition_seasonId_fkey";

-- DropForeignKey
ALTER TABLE "Fixture" DROP CONSTRAINT "Fixture_competitionId_fkey";

-- DropForeignKey
ALTER TABLE "Fixture" DROP CONSTRAINT "Fixture_opponentId_fkey";

-- DropForeignKey
ALTER TABLE "Fixture" DROP CONSTRAINT "Fixture_seasonId_fkey";

-- DropForeignKey
ALTER TABLE "Fixture" DROP CONSTRAINT "Fixture_teamId_fkey";

-- DropForeignKey
ALTER TABLE "Link" DROP CONSTRAINT "Link_articleId_fkey";

-- DropForeignKey
ALTER TABLE "NavigationItem" DROP CONSTRAINT "NavigationItem_linkId_fkey";

-- DropForeignKey
ALTER TABLE "NavigationItem" DROP CONSTRAINT "NavigationItem_navigationId_fkey";

-- DropForeignKey
ALTER TABLE "NavigationItem" DROP CONSTRAINT "NavigationItem_parentId_fkey";

-- DropForeignKey
ALTER TABLE "Player" DROP CONSTRAINT "Player_actionShotId_fkey";

-- DropForeignKey
ALTER TABLE "Player" DROP CONSTRAINT "Player_headshotId_fkey";

-- DropForeignKey
ALTER TABLE "Player" DROP CONSTRAINT "Player_positionId_fkey";

-- DropForeignKey
ALTER TABLE "PlayerTeamHistory" DROP CONSTRAINT "PlayerTeamHistory_playerId_fkey";

-- DropForeignKey
ALTER TABLE "PlayerTeamHistory" DROP CONSTRAINT "PlayerTeamHistory_teamId_fkey";

-- DropForeignKey
ALTER TABLE "Score" DROP CONSTRAINT "Score_fixtureId_fkey";

-- DropForeignKey
ALTER TABLE "Score" DROP CONSTRAINT "Score_playerId_fkey";

-- DropForeignKey
ALTER TABLE "Tag" DROP CONSTRAINT "Tag_groupId_fkey";

-- DropForeignKey
ALTER TABLE "TeamsOnCompetitions" DROP CONSTRAINT "TeamsOnCompetitions_competitionId_fkey";

-- DropForeignKey
ALTER TABLE "TeamsOnCompetitions" DROP CONSTRAINT "TeamsOnCompetitions_teamId_fkey";

-- DropForeignKey
ALTER TABLE "_ArticleToTag" DROP CONSTRAINT "_ArticleToTag_A_fkey";

-- DropForeignKey
ALTER TABLE "_ArticleToTag" DROP CONSTRAINT "_ArticleToTag_B_fkey";

-- DropTable
DROP TABLE "Article";

-- DropTable
DROP TABLE "Author";

-- DropTable
DROP TABLE "AuthorSocialLink";

-- DropTable
DROP TABLE "Club";

-- DropTable
DROP TABLE "Competition";

-- DropTable
DROP TABLE "Fixture";

-- DropTable
DROP TABLE "Image";

-- DropTable
DROP TABLE "Link";

-- DropTable
DROP TABLE "Navigation";

-- DropTable
DROP TABLE "NavigationItem";

-- DropTable
DROP TABLE "Player";

-- DropTable
DROP TABLE "PlayerTeamHistory";

-- DropTable
DROP TABLE "Position";

-- DropTable
DROP TABLE "Score";

-- DropTable
DROP TABLE "Season";

-- DropTable
DROP TABLE "Tag";

-- DropTable
DROP TABLE "TagGroup";

-- DropTable
DROP TABLE "Team";

-- DropTable
DROP TABLE "TeamsOnCompetitions";

-- DropTable
DROP TABLE "_ArticleToTag";

-- DropEnum
DROP TYPE "ScoreType";

