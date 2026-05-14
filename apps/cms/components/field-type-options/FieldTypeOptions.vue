<script setup lang="ts">
import type { FieldTypeOptionsProps } from './fieldTypeOptions.types';
import { QA_FIELD_TYPE_OPTIONS } from './fieldTypeOptions.config';

const props = withDefaults(defineProps<FieldTypeOptionsProps>(), {
  testId: QA_FIELD_TYPE_OPTIONS.COMPONENT,
});

// Tolerate work-in-progress options shape (user editing form): if the
// current options blob fails strict parse (e.g. a half-typed UUID), fall
// back to empty arrays so the UI doesn't blow up. The strict parse runs
// on save via the CRUD endpoint.
const parsed = computed(() => {
  try {
    return parseFieldOptions({ type: props.type, options: props.options });
  } catch {
    return null;
  }
});

const choices = computed(() =>
  parsed.value?.type === 'SELECT' ? parsed.value.choices : []
);

const targetContentTypeIds = computed(() =>
  parsed.value?.type === 'RELATION' ||
  parsed.value?.type === 'MULTIRELATION' ||
  parsed.value?.type === 'RICHTEXT'
    ? parsed.value.targetContentTypeIds
    : []
);

const linkTargetContentTypeIds = computed(() =>
  parsed.value?.type === 'RICHTEXT' ? parsed.value.linkTargetContentTypeIds : []
);

function onChoicesUpdate(val: string) {
  props.updateOptions({
    choices: val
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean),
  });
}
</script>

<template>
  <UFormField v-if="type === 'SELECT'" label="Choices (comma-separated)">
    <UInput
      :model-value="choices.join(', ')"
      placeholder="e.g. option_a, option_b, option_c"
      class="w-full"
      @update:model-value="onChoicesUpdate"
    />
  </UFormField>
  <UFormField
    v-else-if="type === 'RELATION' || type === 'MULTIRELATION'"
    label="Target Content Types"
    required
  >
    <ContentTypeChipPicker
      :model-value="targetContentTypeIds"
      :options="contentTypeOptions"
      @update:model-value="
        (val: string[]) => updateOptions({ targetContentTypeIds: val })
      "
    />
  </UFormField>
  <template v-else-if="type === 'RICHTEXT'">
    <UFormField label="Allowed inline embed types">
      <ContentTypeChipPicker
        :model-value="targetContentTypeIds"
        :options="contentTypeOptions"
        empty-hint="No inline embeds will be allowed in this field. Add a content type to enable inline embeds."
        @update:model-value="
          (val: string[]) => updateOptions({ targetContentTypeIds: val })
        "
      />
    </UFormField>
    <UFormField label="Allowed entry-link target types">
      <ContentTypeChipPicker
        :model-value="linkTargetContentTypeIds"
        :options="contentTypeOptions"
        empty-hint="No entry links will be allowed in this field. Add a content type to enable entry links."
        @update:model-value="
          (val: string[]) => updateOptions({ linkTargetContentTypeIds: val })
        "
      />
    </UFormField>
  </template>
</template>
