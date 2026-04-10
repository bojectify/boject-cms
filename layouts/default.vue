<script setup lang="ts">
import type { NavigationMenuItem, DropdownMenuItem } from '@nuxt/ui';

const { user, clear } = useUserSession();

const fullName = computed(() =>
  `${user.value?.firstName ?? ''} ${user.value?.lastName ?? ''}`.trim()
);

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' });
  await clear();
  await navigateTo('/login');
}

const navItems: NavigationMenuItem[] = [
  { label: 'All Content', icon: 'i-lucide-layout-grid', to: '/' },
  { label: 'Teams', icon: 'i-lucide-shield', to: '/teams' },
  { label: 'Players', icon: 'i-lucide-users', to: '/players' },
  { label: 'Fixtures', icon: 'i-lucide-calendar', to: '/fixtures' },
  { label: 'Clubs', icon: 'i-lucide-landmark', to: '/clubs' },
  { label: 'Competitions', icon: 'i-lucide-trophy', to: '/competitions' },
  { label: 'Seasons', icon: 'i-lucide-clock', to: '/seasons' },
  { label: 'Images', icon: 'i-lucide-image', to: '/images' },
  { label: 'Articles', icon: 'i-lucide-newspaper', to: '/articles' },
  { label: 'Authors', icon: 'i-lucide-pen-tool', to: '/authors' },
  { label: 'Tags', icon: 'i-lucide-tag', to: '/tags' },
  { label: 'Tag Groups', icon: 'i-lucide-tags', to: '/tag-groups' },
  { label: 'Links', icon: 'i-lucide-link', to: '/links' },
  { label: 'Navigations', icon: 'i-lucide-menu', to: '/navigations' },
];

const userMenuItems = computed<DropdownMenuItem[][]>(() => [
  [
    {
      label: fullName.value,
      type: 'label',
    },
  ],
  [
    {
      label: 'Logout',
      icon: 'i-lucide-log-out',
      onSelect: logout,
    },
  ],
]);
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar>
      <template #header>
        <span class="text-lg font-bold">boject</span>
      </template>

      <UNavigationMenu :items="navItems" orientation="vertical" />
    </UDashboardSidebar>

    <UDashboardPanel>
      <template #header>
        <UDashboardNavbar>
          <template #leading>
            <UDashboardSidebarCollapse />
          </template>

          <template #right>
            <UDropdownMenu :items="userMenuItems" size="xl">
              <UAvatar :alt="fullName" size="xl" />
            </UDropdownMenu>
          </template>
        </UDashboardNavbar>
      </template>

      <template #body>
        <slot />
      </template>
    </UDashboardPanel>
  </UDashboardGroup>
</template>
