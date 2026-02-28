<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui';

const { user, clear } = useUserSession();

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' });
  await clear();
  await navigateTo('/login');
}

const items: NavigationMenuItem[] = [
  { label: 'All Content', icon: 'i-lucide-layout-grid', to: '/' },
  { label: 'Teams', icon: 'i-lucide-shield', to: '/teams' },
  { label: 'Players', icon: 'i-lucide-users', to: '/players' },
  { label: 'Fixtures', icon: 'i-lucide-calendar', to: '/fixtures' },
  { label: 'Clubs', icon: 'i-lucide-landmark', to: '/clubs' },
  { label: 'Competitions', icon: 'i-lucide-trophy', to: '/competitions' },
  { label: 'Seasons', icon: 'i-lucide-clock', to: '/seasons' },
  { label: 'Images', icon: 'i-lucide-image', to: '/images' },
];
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar>
      <template #header>
        <span class="text-lg font-bold">boject</span>
      </template>

      <UNavigationMenu :items="items" orientation="vertical" />

      <template #footer>
        <div class="flex items-center justify-between gap-2 px-2">
          <div class="flex items-center gap-2 truncate">
            <UIcon name="i-lucide-user" />
            <span class="truncate text-sm">{{ user?.name }}</span>
          </div>
          <UButton
            icon="i-lucide-log-out"
            variant="ghost"
            size="xs"
            @click="logout"
          />
        </div>
      </template>
    </UDashboardSidebar>

    <UDashboardPanel>
      <template #body>
        <slot />
      </template>
    </UDashboardPanel>
  </UDashboardGroup>
</template>
