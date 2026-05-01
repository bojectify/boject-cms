// apps/cms/scripts/content-bundle/planSchema.ts
//
// Pure planner. Diffs a desired schema bundle against a snapshot of
// current DB state and produces a SchemaPlan.
//
// The diff matrix lives in the originating spec; each row maps to a
// small predicate inside this file.

import type { BundleContentType } from './types';
import type {
  Bundle,
  CurrentSchemaSnapshot,
  PlanOptions,
  SchemaPlan,
  TypeUpdate,
} from './schemaPlan.types';

export function planSchema(
  bundle: Bundle,
  current: CurrentSchemaSnapshot,
  _options: PlanOptions = {}
): SchemaPlan {
  const plan: SchemaPlan = {
    contentTypes: { create: [], update: [], remove: [] },
    fields: { create: [], update: [], remove: [] },
    warnings: [],
    blockers: [],
  };

  const bundleTypes = bundle.contentTypes ?? [];
  const dbTypeByIdentifier = new Map(
    current.contentTypes.map((c) => [c.identifier, c])
  );

  for (const bt of bundleTypes) {
    const db = dbTypeByIdentifier.get(bt.identifier);
    if (!db) {
      plan.contentTypes.create.push(bt);
      continue;
    }

    const update = diffTypeMetadata(bt, db);
    if (update) plan.contentTypes.update.push(update);
  }

  return plan;
}

function diffTypeMetadata(
  bt: BundleContentType,
  db: CurrentSchemaSnapshot['contentTypes'][number]
): TypeUpdate | null {
  const changes: TypeUpdate['changes'] = {};
  if (bt.name !== db.name) changes.name = bt.name;
  if (bt.description !== db.description) changes.description = bt.description;
  if (Object.keys(changes).length === 0) return null;
  return { id: db.id, identifier: bt.identifier, changes };
}
