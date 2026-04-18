<script setup lang="ts">
definePageMeta({ layout: 'auth' });

const { fetch: fetchSession } = useUserSession();

const email = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);

async function login() {
  error.value = '';
  loading.value = true;

  try {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: { email: email.value, password: password.value },
    });
    await fetchSession();
    await navigateTo('/');
  } catch (e: unknown) {
    const msg =
      e && typeof e === 'object' && 'data' in e
        ? (e as { data?: { message?: string } }).data?.message
        : undefined;
    error.value = msg || 'Login failed';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <UCard class="w-full max-w-sm">
    <template #header>
      <div class="text-center">
        <h1 class="text-lg font-bold">boject</h1>
        <p class="text-sm text-muted">Sign in to the CMS</p>
      </div>
    </template>

    <form class="space-y-4" @submit.prevent="login">
      <UFormField label="Email">
        <UInput
          v-model="email"
          type="email"
          placeholder="admin@example.com"
          required
          class="w-full"
        />
      </UFormField>

      <UFormField label="Password">
        <UInput
          v-model="password"
          type="password"
          placeholder="Password"
          required
          class="w-full"
        />
      </UFormField>

      <p v-if="error" class="text-sm text-red-500">{{ error }}</p>

      <UButton type="submit" block :loading="loading"> Sign in </UButton>
    </form>
  </UCard>
</template>
