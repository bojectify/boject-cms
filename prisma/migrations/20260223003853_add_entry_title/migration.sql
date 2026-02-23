-- AlterTable
ALTER TABLE "Club" ADD COLUMN     "entryTitle" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Competition" ADD COLUMN     "entryTitle" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Fixture" ADD COLUMN     "entryTitle" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Image" ADD COLUMN     "entryTitle" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "entryTitle" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Season" ADD COLUMN     "entryTitle" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "entryTitle" TEXT NOT NULL DEFAULT '';
