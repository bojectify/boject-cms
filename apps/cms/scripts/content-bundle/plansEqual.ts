// apps/cms/scripts/content-bundle/plansEqual.ts
//
// Deterministic equality check for two SchemaPlans. Used by the
// applier's in-transaction re-plan check: take two snapshots back
// to back, compute plans, assert equality. If a concurrent writer
// changed something, plansEqual returns false and the applier
// rolls back with SchemaChangedDuringApplyError.
//
// Pure module — no Prisma client, no DB calls.

import type { SchemaPlan } from './schemaPlan.types';

export function plansEqual(a: SchemaPlan, b: SchemaPlan): boolean {
  return canonicalise(a) === canonicalise(b);
}

function canonicalise(plan: SchemaPlan): string {
  return stableStringify({
    contentTypes: {
      create: [...plan.contentTypes.create].sort((x, y) =>
        x.identifier.localeCompare(y.identifier)
      ),
      update: [...plan.contentTypes.update].sort((x, y) =>
        x.identifier.localeCompare(y.identifier)
      ),
      remove: [...plan.contentTypes.remove].sort((x, y) =>
        x.identifier.localeCompare(y.identifier)
      ),
    },
    fields: {
      create: [...plan.fields.create].sort((x, y) =>
        fieldKey(x.contentTypeIdentifier, x.field.identifier).localeCompare(
          fieldKey(y.contentTypeIdentifier, y.field.identifier)
        )
      ),
      update: [...plan.fields.update].sort((x, y) =>
        fieldKey(x.contentTypeIdentifier, x.fieldIdentifier).localeCompare(
          fieldKey(y.contentTypeIdentifier, y.fieldIdentifier)
        )
      ),
      remove: [...plan.fields.remove].sort((x, y) =>
        fieldKey(x.contentTypeIdentifier, x.fieldIdentifier).localeCompare(
          fieldKey(y.contentTypeIdentifier, y.fieldIdentifier)
        )
      ),
    },
    warnings: [...plan.warnings].sort((x, y) =>
      `${x.code}:${x.path}`.localeCompare(`${y.code}:${y.path}`)
    ),
    blockers: [...plan.blockers].sort((x, y) =>
      `${x.code}:${x.path}`.localeCompare(`${y.code}:${y.path}`)
    ),
  });
}

function fieldKey(typeIdentifier: string, fieldIdentifier: string): string {
  return `${typeIdentifier}:${fieldIdentifier}`;
}

// JSON.stringify is insertion-order-sensitive on object keys, so an
// equivalent diff payload built with a different key order would
// compare unequal. stableStringify sorts keys recursively so the
// canonical form depends on content alone.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}
