<script setup lang="ts">
import type { WebhookSecretRevealProps } from './webhookSecretReveal.types';
import { QA_WEBHOOK_SECRET_REVEAL } from './webhookSecretReveal.config';

const props = withDefaults(defineProps<WebhookSecretRevealProps>(), {
  testId: QA_WEBHOOK_SECRET_REVEAL.COMPONENT,
});

async function copy() {
  await navigator.clipboard.writeText(props.secret);
}
</script>

<template>
  <div
    :data-testid="testId"
    class="border border-warning/50 bg-warning/10 rounded-md p-4 mb-6"
  >
    <p class="font-medium mb-2">Your webhook secret</p>
    <p class="text-sm mb-3 text-muted">
      Copy and store this now — it will never be shown again. Use it to verify
      the <code>X-Boject-Signature</code> header on incoming requests.
    </p>
    <div class="flex items-center gap-2">
      <code
        :data-testid="QA_WEBHOOK_SECRET_REVEAL.SECRET"
        class="flex-1 break-all rounded bg-elevated px-3 py-2 text-xs"
        >{{ secret }}</code
      >
      <UButton
        :data-testid="QA_WEBHOOK_SECRET_REVEAL.COPY"
        icon="i-lucide-copy"
        color="neutral"
        variant="subtle"
        @click="copy"
      >
        Copy
      </UButton>
    </div>
  </div>
</template>
