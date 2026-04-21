import { reactive, watch, type Ref } from 'vue';
import type { FieldConfig } from '~/types/contentEditor';

type RelationRef = { contentTypeId: string; entryId: string };

type ResolvedRelation = { entryTitle: string; contentTypeName: string };
type ResolvedMultiRelation = RelationRef & {
  entryTitle: string;
  contentTypeName: string;
};

export function useRelationFieldState(
  formState: Record<string, unknown>,
  editorFields: Ref<FieldConfig[]>
) {
  const { resolveRef, resolveRefs, updateCache } = useRelationResolver();

  const resolvedRelations = reactive<Record<string, ResolvedRelation>>({});
  const resolvedMultiRelations = reactive<
    Record<string, ResolvedMultiRelation[]>
  >({});

  watch(
    () => ({ ...formState }),
    async () => {
      for (const field of editorFields.value) {
        if (field.type === 'dynamic-relation') {
          const val = formState[field.key] as RelationRef | null;
          if (val?.contentTypeId && val?.entryId) {
            const resolved = await resolveRef(val);
            resolvedRelations[field.key] = {
              entryTitle: resolved.entryTitle,
              contentTypeName: resolved.contentTypeName,
            };
          } else {
            Reflect.deleteProperty(resolvedRelations, field.key);
          }
        }
        if (field.type === 'dynamic-multirelation') {
          const val = formState[field.key] as RelationRef[] | null;
          if (val && val.length > 0) {
            resolvedMultiRelations[field.key] = await resolveRefs(val);
          } else {
            resolvedMultiRelations[field.key] = [];
          }
        }
      }
    },
    { immediate: true }
  );

  function getRelationValue(value: unknown): RelationRef | null {
    return (value as RelationRef | null) ?? null;
  }

  function getMultiRelationValue(value: unknown): RelationRef[] {
    return (value as RelationRef[]) ?? [];
  }

  function getTargetContentTypeIds(field: FieldConfig): string[] {
    if (
      field.type === 'dynamic-relation' ||
      field.type === 'dynamic-multirelation'
    ) {
      return field.targetContentTypeIds;
    }
    return [];
  }

  function applyFieldUpdate(fieldKey: string, data: RelationRef) {
    const field = editorFields.value.find((f) => f.key === fieldKey);
    if (!field) return;
    if (field.type === 'dynamic-relation') {
      formState[fieldKey] = {
        contentTypeId: data.contentTypeId,
        entryId: data.entryId,
      };
    } else if (field.type === 'dynamic-multirelation') {
      const current = (formState[fieldKey] as RelationRef[] | undefined) ?? [];
      if (!current.some((r) => r.entryId === data.entryId)) {
        formState[fieldKey] = [...current, data];
      }
    }
  }

  return {
    resolvedRelations,
    resolvedMultiRelations,
    getRelationValue,
    getMultiRelationValue,
    getTargetContentTypeIds,
    applyFieldUpdate,
    updateCache,
  };
}
