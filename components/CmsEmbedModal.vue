<script setup lang="ts">
defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
  select: [embedType: string, embedId: string];
}>();

// Only models with /api/{model}s/options endpoints
const modelTypes = [
  { label: 'Team', value: 'team' },
  { label: 'Club', value: 'club' },
  { label: 'Competition', value: 'competition' },
  { label: 'Season', value: 'season' },
];

const selectedType = ref('team');
const { data: options } = useFetch<{ label: string; value: string }[]>(
  () => `/api/${selectedType.value}s/options`,
  { watch: [selectedType] }
);

const selectedId = ref('');

function confirm() {
  if (selectedId.value) {
    emit('select', selectedType.value, selectedId.value);
    emit('close');
    selectedId.value = '';
  }
}
</script>

<template>
  <UModal :open="open" @close="emit('close')">
    <template #header>
      <h3 class="text-lg font-semibold">Embed Content</h3>
    </template>

    <template #body>
      <div class="space-y-4">
        <UFormField label="Content Type">
          <USelect
            v-model="selectedType"
            :items="modelTypes"
            value-key="value"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Select Item">
          <USelect
            v-model="selectedId"
            :items="options ?? []"
            value-key="value"
            placeholder="Choose..."
            class="w-full"
          />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton variant="ghost" @click="emit('close')">Cancel</UButton>
        <UButton :disabled="!selectedId" @click="confirm">Embed</UButton>
      </div>
    </template>
  </UModal>
</template>
