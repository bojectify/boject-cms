<script setup lang="ts">
import type { FieldConfig } from '~/types/contentEditor';

const route = useRoute();
const id = route.params.id as string;

const fields: FieldConfig[] = [
  { type: 'text', key: 'name', label: 'Name', required: true },
  { type: 'textarea', key: 'bio', label: 'Bio', rows: 6 },
  {
    type: 'relation',
    key: 'headshotId',
    label: 'Headshot',
    optionsEndpoint: '/api/images/options',
  },
];

const { formState, loadingStatus, isSaving, saveError, save, generateSlug } =
  useContentEditor('authors', id);

watch(
  () => formState.name,
  (name) => {
    if (typeof name === 'string') {
      formState.entryTitle = name;
      formState.slug = generateSlug(name);
    }
  }
);

// Social links management
type SocialLink = { platform: string; url: string };

const socialLinks = computed({
  get: () => (formState.socialLinks as SocialLink[] | undefined) ?? [],
  set: (val) => {
    formState.socialLinks = val;
  },
});

function addSocialLink() {
  socialLinks.value = [...socialLinks.value, { platform: '', url: '' }];
}

function removeSocialLink(index: number) {
  socialLinks.value = socialLinks.value.filter((_, i) => i !== index);
}
</script>

<template>
  <ContentEditor
    v-model:state="formState"
    title="Edit Author"
    :fields="fields"
    :loading="loadingStatus === 'pending'"
    :saving="isSaving"
    :error="saveError"
    :on-save="save"
  >
    <template #after-fields>
      <USeparator label="Social Links" />
      <div class="space-y-3">
        <div
          v-for="(link, index) in socialLinks"
          :key="index"
          class="flex gap-3 items-start"
        >
          <UInput
            :model-value="link.platform"
            placeholder="Platform (e.g. twitter)"
            class="w-40"
            @update:model-value="
              socialLinks = socialLinks.map((l, i) =>
                i === index ? { ...l, platform: $event as string } : l
              )
            "
          />
          <UInput
            :model-value="link.url"
            placeholder="URL"
            class="flex-1"
            @update:model-value="
              socialLinks = socialLinks.map((l, i) =>
                i === index ? { ...l, url: $event as string } : l
              )
            "
          />
          <UButton
            color="error"
            variant="ghost"
            icon="i-lucide-trash-2"
            @click="removeSocialLink(index)"
          />
        </div>
        <UButton
          variant="outline"
          icon="i-lucide-plus"
          @click="addSocialLink()"
        >
          Add Social Link
        </UButton>
      </div>
    </template>
  </ContentEditor>
</template>
