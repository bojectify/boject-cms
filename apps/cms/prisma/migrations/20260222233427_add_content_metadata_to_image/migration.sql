-- AlterTable
ALTER TABLE "Image" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "updatedBy" TEXT;
