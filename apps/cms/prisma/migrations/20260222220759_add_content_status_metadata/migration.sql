/*
  Warnings:

  - You are about to drop the column `playerId` on the `Image` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- DropForeignKey
ALTER TABLE "Image" DROP CONSTRAINT "Image_playerId_fkey";

-- AlterTable
ALTER TABLE "Club" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "updatedBy" TEXT;

-- AlterTable
ALTER TABLE "Competition" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "updatedBy" TEXT;

-- AlterTable
ALTER TABLE "Fixture" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "updatedBy" TEXT;

-- AlterTable
ALTER TABLE "Image" DROP COLUMN "playerId";

-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "updatedBy" TEXT;

-- AlterTable
ALTER TABLE "Season" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "updatedBy" TEXT;

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "updatedBy" TEXT;
