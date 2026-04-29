<script setup lang="ts">
import { validatePassword } from '~/utils/validatePassword';

const { user } = useUserSession();
const router = useRouter();
const toast = useToast();

const form = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
});

const errors = reactive({
  current: null as string | null,
  confirm: null as string | null,
});

const isSubmitting = ref(false);

const validation = computed(() =>
  validatePassword(form.newPassword, { email: user.value?.email ?? '' })
);

const confirmMatches = computed(
  () =>
    form.confirmPassword.length > 0 && form.confirmPassword === form.newPassword
);

const canSubmit = computed(
  () =>
    form.currentPassword.length > 0 &&
    validation.value.ok &&
    confirmMatches.value &&
    !isSubmitting.value
);

watch(
  () => form.confirmPassword,
  (val) => {
    if (val.length === 0) {
      errors.confirm = null;
    } else if (val !== form.newPassword) {
      errors.confirm = "Passwords don't match.";
    } else {
      errors.confirm = null;
    }
  }
);

watch(
  () => form.currentPassword,
  () => {
    // Clear server error on edit
    errors.current = null;
  }
);

function cancel() {
  if (import.meta.client && window.history.length > 1) router.back();
  else router.push('/');
}

async function submit() {
  if (!canSubmit.value) return;
  isSubmitting.value = true;
  try {
    await $fetch('/api/account/password', {
      method: 'POST',
      body: {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      },
    });
    form.currentPassword = '';
    form.newPassword = '';
    form.confirmPassword = '';
    toast.add({
      title: 'Password updated',
      description: 'Other devices have been signed out.',
      icon: 'i-lucide-check-circle-2',
      color: 'success',
    });
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    const data = (err as { data?: { error?: string; failures?: string[] } })
      .data;
    if (status === 401) {
      errors.current = 'Current password is incorrect.';
      form.currentPassword = '';
    } else if (status === 400 && data?.error === 'WEAK_PASSWORD') {
      // Defense-in-depth: client + server rule sets are normally in sync, but
      // surface a useful error if the server rejects a password the client
      // approved (e.g. mid-deploy rule drift).
      toast.add({
        title: 'Password rejected',
        description: data.failures?.length
          ? `Failed: ${data.failures.join(', ')}`
          : 'Please choose a different password.',
        color: 'error',
      });
    } else if (status === 429) {
      toast.add({
        title: 'Too many attempts',
        description: 'Wait a minute and try again.',
        color: 'warning',
      });
    } else {
      toast.add({
        title: 'Could not update password',
        description: 'Please try again.',
        color: 'error',
      });
    }
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col">
    <div
      class="flex items-center gap-2 border-b border-default px-14 py-6 text-sm"
    >
      <span class="text-muted">Account</span>
      <span class="text-muted/50">/</span>
      <span class="font-medium text-default">Password</span>
    </div>

    <div class="flex flex-col gap-3 px-14 pt-14">
      <h1 class="text-4xl font-semibold tracking-tight">Password</h1>
      <p class="max-w-xl text-base text-muted">
        Change your account password. You'll stay signed in here, but other
        devices will be signed out.
      </p>
    </div>

    <form
      class="flex max-w-xl flex-col gap-7 px-14 pt-10"
      @submit.prevent="submit"
    >
      <UFormField label="Current password" :error="errors.current ?? undefined">
        <UInput
          v-model="form.currentPassword"
          type="password"
          autocomplete="current-password"
          class="w-full"
        />
      </UFormField>

      <UFormField label="New password">
        <UInput
          v-model="form.newPassword"
          type="password"
          autocomplete="new-password"
          class="w-full"
        />
      </UFormField>

      <UFormField
        label="Confirm new password"
        :error="errors.confirm ?? undefined"
      >
        <UInput
          v-model="form.confirmPassword"
          type="password"
          autocomplete="new-password"
          class="w-full"
        />
      </UFormField>

      <PasswordRequirements :failures="validation.failures" />

      <div class="mt-8 flex justify-end gap-3 border-t border-default pt-10">
        <UButton variant="outline" color="neutral" @click="cancel">
          Cancel
        </UButton>
        <UButton type="submit" :disabled="!canSubmit" :loading="isSubmitting">
          Update password
        </UButton>
      </div>
    </form>
  </div>
</template>
