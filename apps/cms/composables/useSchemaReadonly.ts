// apps/cms/composables/useSchemaReadonly.ts
//
// Reactive boolean reflecting the BOJECT_SCHEMA_READONLY flag on the
// running deployment. UI-only — the security boundary is the server
// helper at server/utils/schemaReadOnly.ts. Use this composable to
// hide affordances pre-emptively; the 403 still fires if a user
// crafts a request manually.

export function useSchemaReadonly() {
  // Read BOJECT_SCHEMA_READONLY from the server's env during SSR and hand it
  // to the client in the payload via useState. Not runtimeConfig: that is
  // fixed when the image is built (#527).
  const readonly = useState<boolean>('schemaReadonly', () =>
    import.meta.server ? isSchemaReadonly(process.env) : false
  );
  return computed(() => readonly.value === true);
}
