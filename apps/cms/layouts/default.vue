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
];

// Dynamic content types section
const { data: contentTypes } = await useFetch<{
  items: Array<{ id: string; name: string }>;
}>('/api/content-types', {
  key: 'sidebar-content-types',
  query: { perPage: 50 },
});

const dynamicNavItems = computed<NavigationMenuItem[]>(() => {
  const items: NavigationMenuItem[] = [
    { label: 'Content Types', icon: 'i-lucide-blocks', to: '/content-types' },
  ];
  for (const ct of contentTypes.value?.items ?? []) {
    items.push({
      label: ct.name,
      icon: 'i-lucide-file-text',
      to: `/content-types/${ct.id}/entries`,
    });
  }
  return items;
});

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
      <USeparator class="my-2" />
      <UNavigationMenu :items="dynamicNavItems" orientation="vertical" />
    </UDashboardSidebar>

    <UDashboardPanel
      :ui="{
        body: 'flex flex-col gap-4 sm:gap-6 flex-1 overflow-y-auto p-0 sm:p-0',
      }"
    >
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
