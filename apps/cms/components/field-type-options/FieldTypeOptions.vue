<script setup lang="ts">
import type { FieldTypeOptionsProps } from './fieldTypeOptions.types';
import { QA_FIELD_TYPE_OPTIONS } from './fieldTypeOptions.config';
import { FIELD_TYPES } from '~/utils/fieldTypes';
import { parseFieldOptions } from '~/utils/fieldOptions';

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
  parsed.value?.type === FIELD_TYPES.SELECT ? parsed.value.choices : []
);

const targetContentTypeIds = computed(() =>
  parsed.value?.type === FIELD_TYPES.RELATION ||
  parsed.value?.type === FIELD_TYPES.MULTIRELATION ||
  parsed.value?.type === FIELD_TYPES.RICHTEXT
    ? parsed.value.targetContentTypeIds
    : []
);

const linkTargetContentTypeIds = computed(() =>
  parsed.value?.type === FIELD_TYPES.RICHTEXT
    ? parsed.value.linkTargetContentTypeIds
    : []
);

// Raw configured default: `true`, `false`, or `undefined` (no default). Kept
// undefined-distinct (no `?? false`) so the tri-state control can highlight
// "None" separately from an explicit "False".
const booleanDefault = computed<boolean | undefined>(() =>
  parsed.value?.type === FIELD_TYPES.BOOLEAN ? parsed.value.default : undefined
);

// A required BOOLEAN must default to True or False — "None" is disabled in the
// control and the modal blocks save while this holds (#344).
const requiredBooleanDefaultMissing = computed(
  () =>
    props.type === FIELD_TYPES.BOOLEAN &&
    !!props.required &&
    booleanDefault.value === undefined
);

const numberDefault = computed(() =>
  parsed.value?.type === FIELD_TYPES.NUMBER
    ? (parsed.value.default ?? null)
    : null
);
// Reka UI's SelectItem forbids an empty-string value, so the "no default"
// option uses a sentinel that maps back to `undefined` (clears the default).
const SELECT_NONE = '__none__';

const selectDefault = computed(() =>
  parsed.value?.type === FIELD_TYPES.SELECT
    ? (parsed.value.default ?? SELECT_NONE)
    : SELECT_NONE
);

const selectDefaultItems = computed(() => [
  { label: '— none —', value: SELECT_NONE },
  ...choices.value.map((c) => ({ label: c, value: c })),
]);

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
  <template v-if="type === FIELD_TYPES.SELECT">
    <UFormField label="Choices (comma-separated)">
      <UInput
        :model-value="choices.join(', ')"
        placeholder="e.g. option_a, option_b, option_c"
        class="w-full"
        @update:model-value="onChoicesUpdate"
      />
    </UFormField>
    <UFormField v-if="choices.length > 0" label="Default value">
      <USelect
        :data-testid="QA_FIELD_TYPE_OPTIONS.DEFAULT"
        :model-value="selectDefault"
        :items="selectDefaultItems"
        class="w-full"
        @update:model-value="
          (v: string) =>
            updateOptions({ default: v === SELECT_NONE ? undefined : v })
        "
      />
    </UFormField>
  </template>
  <UFormField
    v-else-if="type === FIELD_TYPES.BOOLEAN"
    label="Default value"
    :error="
      requiredBooleanDefaultMissing
        ? 'Required boolean fields must default to True or False.'
        : undefined
    "
  >
    <BooleanTriState
      :test-id="QA_FIELD_TYPE_OPTIONS.DEFAULT"
      :model-value="booleanDefault"
      :disable-none="required"
      @update:model-value="
        (v: boolean | undefined) => updateOptions({ default: v })
      "
    />
  </UFormField>
  <UFormField v-else-if="type === FIELD_TYPES.NUMBER" label="Default value">
    <UInput
      :data-testid="QA_FIELD_TYPE_OPTIONS.DEFAULT"
      type="number"
      :model-value="numberDefault"
      placeholder="No default"
      class="w-full"
      @update:model-value="
        (v: number | null) =>
          updateOptions({ default: v === null ? undefined : Number(v) })
      "
    />
  </UFormField>
  <UFormField
    v-else-if="
      type === FIELD_TYPES.RELATION || type === FIELD_TYPES.MULTIRELATION
    "
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
  <template v-else-if="type === FIELD_TYPES.RICHTEXT">
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
