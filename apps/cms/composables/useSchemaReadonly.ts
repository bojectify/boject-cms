// apps/cms/composables/useSchemaReadonly.ts
//
// Reactive boolean reflecting the BOJECT_SCHEMA_READONLY flag on the
// running deployment. UI-only — the security boundary is the server
// helper at server/utils/schemaReadOnly.ts. Use this composable to
// hide affordances pre-emptively; the 403 still fires if a user
// crafts a request manually.

export function useSchemaReadonly() {
  const config = useRuntimeConfig();
  return computed(() => config.public.schemaReadonly === true);
}
