-- AlterTable
ALTER TABLE "Club" ADD COLUMN     "slug" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Competition" ADD COLUMN     "slug" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Fixture" ADD COLUMN     "slug" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "slug" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Season" ADD COLUMN     "slug" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "slug" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Club_slug_key" ON "Club"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Competition_slug_key" ON "Competition"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Fixture_slug_key" ON "Fixture"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Player_slug_key" ON "Player"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Season_slug_key" ON "Season"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Team_slug_key" ON "Team"("slug");
