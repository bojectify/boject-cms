-- AlterEnum: add the internal+external bulk-content-sync event (#393)
ALTER TYPE "WebhookEvent" ADD VALUE 'CONTENT_BULK_SYNC';
