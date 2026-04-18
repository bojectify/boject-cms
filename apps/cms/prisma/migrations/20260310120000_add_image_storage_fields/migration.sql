-- AlterTable
ALTER TABLE "Image" ADD COLUMN "storagePath" TEXT,
ADD COLUMN "mimeType" TEXT,
ADD COLUMN "fileSize" INTEGER,
ADD COLUMN "originalName" TEXT;
