export interface EntryUniqueConflict {
  kind: 'entry';
  field: string;
  message: string;
  value: unknown;
}

export interface FieldUniqueConflict {
  kind: 'field';
  message: string;
  conflicts: Array<{ value: unknown; entryIds: string[] }>;
}

export type UniqueConflict = EntryUniqueConflict | FieldUniqueConflict;

export function parseUniqueConflict(err: unknown): UniqueConflict | null {
  if (!err || typeof err !== 'object') return null;
  const anyErr = err as {
    statusCode?: number;
    data?: { data?: Record<string, unknown>; [key: string]: unknown };
  };
  if (anyErr.statusCode !== 409) return null;
  const payload = (anyErr.data?.data ?? anyErr.data) as
    | {
        error?: string;
        field?: string;
        message?: string;
        conflicts?: unknown;
        value?: unknown;
      }
    | undefined;
  if (!payload || payload.error !== 'UNIQUE_CONFLICT') return null;
  if (Array.isArray(payload.conflicts)) {
    return {
      kind: 'field',
      message:
        payload.message ??
        'Cannot mark field as unique — existing entries have duplicate values',
      conflicts: payload.conflicts as Array<{
        value: unknown;
        entryIds: string[];
      }>,
    };
  }
  if (typeof payload.field === 'string') {
    return {
      kind: 'entry',
      field: payload.field,
      message: payload.message ?? 'Must be unique',
      value: payload.value,
    };
  }
  return null;
}
