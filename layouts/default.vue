<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui';

const items: NavigationMenuItem[] = [
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
    </UDashboardSidebar>

    <UDashboardPanel>
      <slot />
    </UDashboardPanel>
  </UDashboardGroup>
</template>
