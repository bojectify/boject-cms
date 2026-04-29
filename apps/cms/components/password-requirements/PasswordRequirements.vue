<script setup lang="ts">
import { PASSWORD_RULES } from '~/utils/validatePassword';
import { QA_PASSWORD_REQUIREMENTS } from './passwordRequirements.config';
import type { PasswordRequirementsProps } from './passwordRequirements.types';

const props = defineProps<PasswordRequirementsProps>();

const rows = computed(() =>
  PASSWORD_RULES.map((rule) => ({
    id: rule.id,
    label: rule.label,
    satisfied: !props.failures.includes(rule.id),
  }))
);
</script>

<template>
  <div
    :data-testid="props.testId ?? QA_PASSWORD_REQUIREMENTS.COMPONENT"
    class="flex flex-col gap-3 rounded-lg border border-default bg-elevated/50 px-5 py-4"
  >
    <div class="text-xs font-medium uppercase tracking-wider text-muted">
      Requirements
    </div>
    <div
      v-for="row in rows"
      :key="row.id"
      :data-testid="QA_PASSWORD_REQUIREMENTS.RULE"
      class="flex items-center gap-2.5"
    >
      <UIcon
        :name="row.satisfied ? 'i-lucide-check-circle-2' : 'i-lucide-circle'"
        :data-testid="QA_PASSWORD_REQUIREMENTS.RULE_ICON"
        :class="
          row.satisfied
            ? 'h-4 w-4 flex-shrink-0 text-success'
            : 'h-4 w-4 flex-shrink-0 text-muted'
        "
      />
      <span
        :data-testid="QA_PASSWORD_REQUIREMENTS.RULE_LABEL"
        :class="row.satisfied ? 'text-sm text-default' : 'text-sm text-muted'"
      >
        {{ row.label }}
      </span>
    </div>
  </div>
</template>
