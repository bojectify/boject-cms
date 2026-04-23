import { runCleanup } from '../utils/webhookCleanup';

export default defineTask({
  meta: {
    name: 'webhooks:cleanup',
    description: 'Prune WebhookDelivery rows older than 30 days',
  },
  async run() {
    const deleted = await runCleanup({
      prisma: prisma as never,
      now: () => new Date(),
    });
    return { result: { deleted } };
  },
});
