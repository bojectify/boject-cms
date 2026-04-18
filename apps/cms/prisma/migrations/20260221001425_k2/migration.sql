/*
  Warnings:

  - You are about to drop the column `teamId` on the `Competition` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Competition" DROP CONSTRAINT "Competition_teamId_fkey";

-- AlterTable
ALTER TABLE "Competition" DROP COLUMN "teamId";

-- CreateTable
CREATE TABLE "TeamsOnCompetitions" (
    "teamId" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,

    CONSTRAINT "TeamsOnCompetitions_pkey" PRIMARY KEY ("teamId","competitionId")
);

-- AddForeignKey
ALTER TABLE "TeamsOnCompetitions" ADD CONSTRAINT "TeamsOnCompetitions_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamsOnCompetitions" ADD CONSTRAINT "TeamsOnCompetitions_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
