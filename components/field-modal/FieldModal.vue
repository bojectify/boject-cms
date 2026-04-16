<script setup lang="ts">
import type { FieldFormData, FieldModalProps } from './fieldModal.types';
import { QA_FIELD_MODAL } from './fieldModal.config';

const props = withDefaults(defineProps<FieldModalProps>(), {
  testId: QA_FIELD_MODAL.COMPONENT,
});

const emit = defineEmits<{
  close: [];
  save: [data: FieldFormData];
  delete: [fieldId: string];
}>();

const formName = ref('');
const formIdentifier = ref('');
const identifierTouched = ref(false);
const formType = ref('TEXT');
const formRequired = ref(false);
const formOptions = ref<unknown>(null);

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      if (props.mode === 'edit' && props.field) {
        formName.value = props.field.name;
        formIdentifier.value = props.field.identifier;
        formType.value = props.field.type;
        formRequired.value = props.field.required;
        formOptions.value = props.field.options ?? null;
        identifierTouched.value = true;
      } else {
        formName.value = '';
        formIdentifier.value = '';
        formType.value = 'TEXT';
        formRequired.value = false;
        formOptions.value = null;
        identifierTouched.value = false;
      }
    }
  }
);

watch(formName, (val) => {
  if (props.mode === 'add' && !identifierTouched.value) {
    formIdentifier.value = toCamelCase(val);
  }
});

const canSave = computed(() => {
  if (props.mode === 'add') {
    return formName.value.trim() && formIdentifier.value.trim();
  }
  return formName.value.trim();
});

function handleSave() {
  if (!canSave.value) return;
  emit('save', {
    identifier: formIdentifier.value.trim(),
    name: formName.value.trim(),
    type: formType.value,
    required: formRequired.value,
    options: formOptions.value,
  });
}

function handleDelete() {
  if (props.field?.id) {
    emit('delete', props.field.id);
  }
}

function updateOptions(val: unknown) {
  formOptions.value = val;
}

const canDelete = computed(() => {
  return props.mode === 'edit' && props.field?.type !== 'ENTRY_TITLE';
});
</script>

<template>
  <UModal
    :data-testid="testId"
    :open="open"
    @update:open="
      (val: boolean) => {
        if (!val) emit('close');
      }
    "
  >
    <template #header>
      <div class="flex items-center gap-2">
        <h3 class="text-lg font-semibold">
          {{ mode === 'add' ? 'Add Field' : 'Edit Field' }}
        </h3>
        <UBadge
          v-if="mode === 'edit'"
          size="sm"
          variant="subtle"
          color="success"
        >
          {{ field?.type }}
        </UBadge>
      </div>
    </template>

    <template #body>
      <div class="space-y-4">
        <!-- Info bar (edit mode only) -->
        <div
          v-if="mode === 'edit'"
          class="flex items-center gap-4 text-sm rounded-lg bg-gray-50 dark:bg-gray-900 p-3 -mt-1"
        >
          <div class="flex items-center gap-1.5">
            <span class="text-muted">Identifier:</span>
            <span class="font-medium">{{ field?.identifier }}</span>
          </div>
          <USeparator orientation="vertical" class="h-4" />
          <div class="flex items-center gap-1.5">
            <span class="text-muted">Used in:</span>
            <span class="font-medium">{{ entryCount ?? 0 }} entries</span>
          </div>
        </div>

        <UFormField label="Name" required>
          <UInput
            v-model="formName"
            :placeholder="mode === 'add' ? 'e.g. Publish Date' : ''"
            class="w-full"
          />
        </UFormField>

        <!-- Identifier (add mode only) -->
        <UFormField
          v-if="mode === 'add'"
          label="Identifier"
          required
          hint="camelCase, auto-generated"
        >
          <UInput
            v-model="formIdentifier"
            placeholder="e.g. publishDate"
            class="w-full"
            @input="identifierTouched = true"
          />
        </UFormField>

        <!-- Type + Required row (add mode) -->
        <div v-if="mode === 'add'" class="grid grid-cols-2 gap-4">
          <UFormField label="Type">
            <USelect
              v-model="formType"
              :items="fieldTypeOptions"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField label=" ">
            <USwitch v-model="formRequired" label="Required" />
          </UFormField>
        </div>

        <!-- Required toggle (edit mode — type is read-only) -->
        <UFormField v-if="mode === 'edit'" label="Required">
          <USwitch v-model="formRequired" />
        </UFormField>

        <!-- Type-specific options slot -->
        <slot
          name="type-options"
          :type="formType"
          :options="formOptions"
          :update-options="updateOptions"
        />

        <!-- Danger zone (edit mode, non-ENTRY_TITLE) -->
        <div v-if="canDelete" class="pt-4">
          <USeparator color="error" />
          <div class="flex items-center justify-between pt-4">
            <div>
              <p class="text-sm font-medium text-red-700 dark:text-red-400">
                Delete this field
              </p>
              <p class="text-xs text-muted">
                Data in {{ entryCount ?? 0 }} entries will be preserved but
                hidden
              </p>
            </div>
            <UButton
              size="sm"
              variant="outline"
              color="error"
              @click="handleDelete"
            >
              Delete
            </UButton>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton variant="ghost" @click="emit('close')">Cancel</UButton>
        <UButton :disabled="!canSave" @click="handleSave">
          {{ mode === 'add' ? 'Add Field' : 'Save Changes' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
