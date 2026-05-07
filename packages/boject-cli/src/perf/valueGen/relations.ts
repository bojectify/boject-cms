import { intInRange, pickOne, sampleWithoutReplacement } from '../prng.js';

export interface RelationTargetPool {
  contentTypeId: string;
  contentTypeIdentifier: string;
  entryIds: string[];
}

export interface RelationValue {
  contentTypeId: string;
  contentTypeIdentifier: string;
  entryId: string;
}

export function generateRelation(opts: {
  rand: () => number;
  pool: RelationTargetPool[];
}): RelationValue | null {
  const usable = opts.pool.filter((p) => p.entryIds.length > 0);
  if (usable.length === 0) return null;
  const target = pickOne(usable, opts.rand);
  return {
    contentTypeId: target.contentTypeId,
    contentTypeIdentifier: target.contentTypeIdentifier,
    entryId: pickOne(target.entryIds, opts.rand),
  };
}

export function generateMultirelation(opts: {
  rand: () => number;
  pool: RelationTargetPool[];
  fanout: { min: number; max: number };
}): RelationValue[] {
  const usable = opts.pool.filter((p) => p.entryIds.length > 0);
  if (usable.length === 0) return [];
  const totalAvailable = usable.reduce((s, p) => s + p.entryIds.length, 0);
  const cap = Math.min(opts.fanout.max, totalAvailable);
  if (cap < opts.fanout.min) return [];
  const n = intInRange(opts.fanout.min, cap, opts.rand);
  if (n === 0) return [];

  // Build a flat ref pool, then sample without replacement
  const flat: RelationValue[] = [];
  for (const p of usable) {
    for (const eid of p.entryIds) {
      flat.push({
        contentTypeId: p.contentTypeId,
        contentTypeIdentifier: p.contentTypeIdentifier,
        entryId: eid,
      });
    }
  }
  return sampleWithoutReplacement(flat, n, opts.rand);
}
