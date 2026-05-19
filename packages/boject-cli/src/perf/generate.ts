import type {
  Bundle,
  BundleContentType,
  BundleEntry,
  BundleField,
} from '../vendor/contentBundleTypes.js';
import { rng } from './prng.js';
import { topoSort, type Edge } from './topoSort.js';
import {
  generateBoolean,
  generateDatetime,
  generateEntryTitle,
  generateNumber,
  generateSelect,
  generateSlug,
  generateText,
  generateTextarea,
} from './valueGen/scalars.js';
import {
  generateRichtext,
  type RichtextRefPool,
  type RichtextRefTarget,
} from './valueGen/richtext.js';
import {
  generateMultirelation,
  generateRelation,
  type RelationTargetPool,
} from './valueGen/relations.js';
import { generateImage } from './valueGen/image.js';
import { slugify } from '../vendor/slugify.js';
import { FIELD_TYPES } from '../vendor/fieldTypes.js';
import { CONTENT_STATUSES } from '../vendor/contentStatus.js';

export interface GenerateOptions {
  contentTypeIdentifier: string;
  count: number;
  seed?: number;
  multirelationFanout?: { min: number; max: number };
  datetimeWindow?: { from: Date; to: Date };
  targetCount?: (identifier: string) => number;
}

export interface GeneratedSeedGroup {
  contentTypeIdentifier: string;
  entries: BundleEntry[];
  patches?: Array<{ entryId: string; fieldUpdates: Record<string, unknown> }>;
}

export interface GeneratedSeed {
  groups: GeneratedSeedGroup[];
  warnings: string[];
}

const DEFAULT_FANOUT = { min: 0, max: 5 };
const DEFAULT_TARGET_CAP = 200;

/**
 * Generates a deterministic UUID-v4-shaped string from the seeded PRNG.
 * Not cryptographically random — fine for perf seed data; required so a
 * seeded run produces byte-identical output across invocations.
 *
 * Underlying PRNG is xorshift32 with period 2^32 (~4.3 billion). Each
 * UUID consumes ~5 rand() calls, so the safe ceiling is ~860M UUIDs
 * before the sequence repeats. Production runs (50K-200K entries) sit
 * orders of magnitude below that. See `generate.test.ts` uniqueness
 * tests for empirical coverage.
 */
function nextUuid(rand: () => number): string {
  const hex = (n: number, width: number): string =>
    Math.floor(rand() * Math.pow(16, n))
      .toString(16)
      .padStart(width, '0');
  // We want 32 hex chars total, broken into the 8-4-4-4-12 layout.
  const segments = [
    hex(8, 8),
    hex(4, 4),
    // Force version-4 nibble in the third group.
    '4' + hex(3, 3),
    // Force variant nibble (8/9/a/b) in the fourth group.
    (Math.floor(rand() * 4) + 8).toString(16) + hex(3, 3),
    hex(8, 8) + hex(4, 4),
  ];
  return segments.join('-');
}

export function generatePerfData(
  bundle: Bundle,
  options: GenerateOptions
): GeneratedSeed {
  const types = bundle.contentTypes ?? [];
  const target = types.find(
    (t) => t.identifier === options.contentTypeIdentifier
  );
  if (!target) {
    throw new Error(
      `Unknown content type "${options.contentTypeIdentifier}". ` +
        `Available: ${types.map((t) => t.identifier).join(', ') || '(none)'}`
    );
  }

  const window = options.datetimeWindow ?? defaultWindow();
  const fanout = options.multirelationFanout ?? DEFAULT_FANOUT;
  const seed = options.seed ?? 1;
  const warnings: string[] = [];
  // Stable timestamp derived from the seed — keeps output deterministic across runs.
  const publishedAtIso = new Date(window.from.getTime()).toISOString();

  // 1. Build the dependency graph rooted at the requested type.
  const identifierToType = new Map<string, BundleContentType>(
    types.map((t) => [t.identifier, t])
  );
  const idToIdentifier = buildIdToIdentifierMap(types);
  const reachable = collectReachable(target, identifierToType, idToIdentifier);
  const edges = buildEdges(reachable, identifierToType, idToIdentifier);
  const sorted = topoSort(
    reachable.map((t) => t.identifier),
    edges
  );

  // 2. Compute size per type
  const sizeFor = (id: string): number => {
    if (id === options.contentTypeIdentifier) return options.count;
    if (options.targetCount) return options.targetCount(id);
    return Math.min(options.count, DEFAULT_TARGET_CAP);
  };

  // 3. Generate group-by-group, threading entry-id pools forward
  // Map keyed by content-type identifier. Readers (RELATION/MULTIRELATION/RICHTEXT
  // pool builders) resolve targets via resolveFieldTargetIdentifiers, so this lookup is O(1).
  const idPools = new Map<string, RelationTargetPool>();
  const groups: GeneratedSeedGroup[] = [];
  const rand = rng(seed);

  // Map deferred edges by source type for quick lookup
  const deferredByType = new Map<string, Edge[]>();
  for (const e of sorted.deferredEdges) {
    const list = deferredByType.get(e.from) ?? [];
    list.push(e);
    deferredByType.set(e.from, list);
  }

  for (const identifier of sorted.order) {
    const ct = identifierToType.get(identifier)!;
    const count = sizeFor(identifier);
    const deferred = deferredByType.get(identifier) ?? [];
    const deferredFieldIds = new Set(deferred.map((e) => e.field));
    const fieldByIdentifier = new Map(ct.fields.map((f) => [f.identifier, f]));

    const entries: BundleEntry[] = [];
    const patches: GeneratedSeedGroup['patches'] = [];
    const uniqueTrackers = new Map<string, Set<string>>();
    const slugField = ct.fields.find((f) => f.type === FIELD_TYPES.SLUG);

    // First pass: build entries with deferred fields omitted; SLUG handled inline
    for (let i = 0; i < count; i++) {
      const entryId = nextUuid(rand);
      const data: Record<string, unknown> = {};
      let entryTitle = '';

      for (const field of ct.fields) {
        if (deferredFieldIds.has(field.identifier)) continue;
        if (field.type === FIELD_TYPES.SLUG) continue; // handled after the loop so entryTitle is captured

        const value = generateFieldValue({
          field,
          rand,
          index: i,
          window,
          fanout,
          uniqueTrackers,
          idPools,
          idToIdentifier,
          warnings,
          contentTypeIdentifier: ct.identifier,
        });
        if (value === undefined) continue;
        data[field.identifier] = value;
        if (field.type === FIELD_TYPES.ENTRY_TITLE)
          entryTitle = value as string;
      }

      // SLUG is synthesised after ENTRY_TITLE so it can derive from the actual title
      if (slugField && !deferredFieldIds.has(slugField.identifier)) {
        const slugValue = generateSlug({
          entryTitle: entryTitle || `entry-${i}`,
          index: i,
        });
        data[slugField.identifier] = slugValue;
      }
      const slugForEnvelope = slugField
        ? (data[slugField.identifier] as string | undefined)
        : null;

      entries.push({
        id: entryId,
        contentTypeId: ct.id,
        contentTypeIdentifier: ct.identifier,
        entryTitle,
        entryKey: slugify(entryTitle),
        slug: slugForEnvelope ?? null,
        versions: [
          {
            status: CONTENT_STATUSES.PUBLISHED,
            data,
            publishedAt: publishedAtIso,
          },
        ],
      });
    }

    // Update the pool BEFORE deferred-field patches so self-references can use sibling IDs.
    // Keyed by identifier — see the canonical-identifier convention used by
    // applySchema.ts / planSchema.ts on the CMS server side.
    idPools.set(ct.identifier, {
      contentTypeId: ct.identifier,
      contentTypeIdentifier: ct.identifier,
      entryIds: entries.map((e) => e.id!),
    });

    // Second pass: synthesise deferred-field patches
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const fieldUpdates: Record<string, unknown> = {};
      for (const edge of deferred) {
        const field = fieldByIdentifier.get(edge.field);
        if (!field) continue;
        const value = generateFieldValue({
          field,
          rand,
          index: i,
          window,
          fanout,
          uniqueTrackers,
          idPools,
          idToIdentifier,
          warnings,
          contentTypeIdentifier: ct.identifier,
        });
        if (value === undefined) continue;
        fieldUpdates[field.identifier] = value;
      }
      if (Object.keys(fieldUpdates).length > 0) {
        patches!.push({ entryId: entry.id!, fieldUpdates });
      }
    }

    groups.push({
      contentTypeIdentifier: ct.identifier,
      entries,
      patches: patches!.length > 0 ? patches : undefined,
    });
  }

  return { groups, warnings };
}

/**
 * Builds a UUID → identifier map from the bundle's content type list.
 * Empty for fully portable bundles (where every `ct.id` is null). Used
 * by `resolveFieldTargetIdentifiers` to translate non-portable
 * `targetContentTypeIds` arrays into the canonical identifier form.
 */
function buildIdToIdentifierMap(
  types: BundleContentType[]
): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of types) {
    if (t.id) out.set(t.id, t.identifier);
  }
  return out;
}

/**
 * Resolves a relation/embed field's target content-type list to a
 * canonical identifier array, accepting both portable and non-portable
 * bundle shapes:
 *
 *   - Portable: `targetContentTypeIdentifiers` is populated; UUIDs are null
 *   - Non-portable: `targetContentTypeIds` carries UUIDs; identifiers
 *     are derived via `idToIdentifier`
 *
 * Returns identifier strings only — never UUIDs, never nulls. Skips
 * any UUID that's not in the map (lets the caller decide how to handle
 * orphaned references; today every caller treats missing pools as
 * empty, so the silent skip matches existing behaviour).
 */
function resolveFieldTargetIdentifiers(
  targetIds: Array<string | null> | undefined,
  targetIdentifiers: string[] | undefined,
  idToIdentifier: Map<string, string>
): string[] {
  if (targetIdentifiers && targetIdentifiers.length > 0) {
    return targetIdentifiers;
  }
  if (!targetIds) return [];
  const out: string[] = [];
  for (const id of targetIds) {
    if (typeof id !== 'string') continue;
    const ident = idToIdentifier.get(id);
    if (ident) out.push(ident);
  }
  return out;
}

function collectReachable(
  root: BundleContentType,
  identifierToType: Map<string, BundleContentType>,
  idToIdentifier: Map<string, string>
): BundleContentType[] {
  const seen = new Set<string>();
  const out: BundleContentType[] = [];
  const queue: BundleContentType[] = [root];
  while (queue.length > 0) {
    const t = queue.shift()!;
    if (seen.has(t.identifier)) continue;
    seen.add(t.identifier);
    out.push(t);
    for (const f of t.fields) {
      if (
        f.type !== FIELD_TYPES.RELATION &&
        f.type !== FIELD_TYPES.MULTIRELATION
      )
        continue;
      const targets = resolveFieldTargetIdentifiers(
        f.options?.targetContentTypeIds as Array<string | null> | undefined,
        f.options?.targetContentTypeIdentifiers,
        idToIdentifier
      );
      for (const ident of targets) {
        const target = identifierToType.get(ident);
        if (target && !seen.has(target.identifier)) queue.push(target);
      }
    }
  }
  return out;
}

function buildEdges(
  types: BundleContentType[],
  identifierToType: Map<string, BundleContentType>,
  idToIdentifier: Map<string, string>
): Edge[] {
  const edges: Edge[] = [];
  for (const t of types) {
    for (const f of t.fields) {
      if (
        f.type !== FIELD_TYPES.RELATION &&
        f.type !== FIELD_TYPES.MULTIRELATION
      )
        continue;
      const targets = resolveFieldTargetIdentifiers(
        f.options?.targetContentTypeIds as Array<string | null> | undefined,
        f.options?.targetContentTypeIdentifiers,
        idToIdentifier
      );
      for (const ident of targets) {
        const target = identifierToType.get(ident);
        if (!target) continue;
        // For MULTIRELATION the empty array satisfies any cardinality, so
        // treat as optional even when field.required is true.
        const required = f.type === FIELD_TYPES.RELATION && f.required;
        edges.push({
          from: t.identifier,
          to: target.identifier,
          field: f.identifier,
          required,
        });
      }
    }
  }
  return edges;
}

interface FieldGenContext {
  field: BundleField;
  rand: () => number;
  index: number;
  window: { from: Date; to: Date };
  fanout: { min: number; max: number };
  uniqueTrackers: Map<string, Set<string>>;
  idPools: Map<string, RelationTargetPool>;
  idToIdentifier: Map<string, string>;
  warnings: string[];
  contentTypeIdentifier: string;
}

function generateFieldValue(ctx: FieldGenContext): unknown {
  const { field } = ctx;
  switch (field.type) {
    case FIELD_TYPES.ENTRY_TITLE:
      return generateEntryTitle({ rand: ctx.rand, index: ctx.index });
    case FIELD_TYPES.SLUG:
      // SLUG is handled inline by the orchestrator (after ENTRY_TITLE),
      // so this branch shouldn't be reached during normal walk. Return
      // undefined defensively in case someone calls this directly.
      return undefined;
    case FIELD_TYPES.TEXT: {
      const key = `${ctx.contentTypeIdentifier}.${field.identifier}`;
      let tracker = ctx.uniqueTrackers.get(key);
      if (!tracker) {
        tracker = new Set();
        ctx.uniqueTrackers.set(key, tracker);
      }
      return generateText({
        rand: ctx.rand,
        unique: field.unique === true,
        index: ctx.index,
        seenValues: tracker,
      });
    }
    case FIELD_TYPES.TEXTAREA:
      return generateTextarea({ rand: ctx.rand });
    case FIELD_TYPES.NUMBER:
      return generateNumber({
        rand: ctx.rand,
        unique: field.unique === true,
        index: ctx.index,
      });
    case FIELD_TYPES.BOOLEAN:
      return generateBoolean({ rand: ctx.rand });
    case FIELD_TYPES.DATETIME:
      return generateDatetime({ rand: ctx.rand, window: ctx.window });
    case FIELD_TYPES.SELECT:
      return generateSelect({
        rand: ctx.rand,
        choices: (field.options?.choices ?? []) as string[],
      });
    case FIELD_TYPES.RICHTEXT: {
      const refPool = buildRichtextRefPool(
        field,
        ctx.idPools,
        ctx.idToIdentifier
      );
      return generateRichtext({ rand: ctx.rand, refPool });
    }
    case FIELD_TYPES.RELATION: {
      const pool = buildRelationPool(field, ctx.idPools, ctx.idToIdentifier);
      return generateRelation({ rand: ctx.rand, pool });
    }
    case FIELD_TYPES.MULTIRELATION: {
      const pool = buildRelationPool(field, ctx.idPools, ctx.idToIdentifier);
      return generateMultirelation({
        rand: ctx.rand,
        pool,
        fanout: ctx.fanout,
      });
    }
    case FIELD_TYPES.IMAGE:
      return generateImage({ rand: ctx.rand, index: ctx.index });
    default:
      ctx.warnings.push(
        `unknown field type "${field.type}" on ${ctx.contentTypeIdentifier}.${field.identifier}`
      );
      return undefined;
  }
}

function buildRelationPool(
  field: BundleField,
  idPools: Map<string, RelationTargetPool>,
  idToIdentifier: Map<string, string>
): RelationTargetPool[] {
  const targetIdentifiers = resolveFieldTargetIdentifiers(
    field.options?.targetContentTypeIds as Array<string | null> | undefined,
    field.options?.targetContentTypeIdentifiers,
    idToIdentifier
  );
  const pool: RelationTargetPool[] = [];
  for (const ident of targetIdentifiers) {
    const entry = idPools.get(ident);
    if (entry) pool.push(entry);
  }
  return pool;
}

function buildRichtextRefPool(
  field: BundleField,
  idPools: Map<string, RelationTargetPool>,
  idToIdentifier: Map<string, string>
): RichtextRefPool | null {
  const embedTargets = resolveFieldTargetIdentifiers(
    field.options?.targetContentTypeIds as Array<string | null> | undefined,
    field.options?.targetContentTypeIdentifiers,
    idToIdentifier
  );
  // Link allow-list: portable form NOT yet emitted by the CMS (no
  // `linkTargetContentTypeIdentifiers` field in BundleFieldOptions).
  // Resolves via UUIDs only — link allow-lists in portable bundles are
  // a separate CMS-side concern (see spec out-of-scope).
  const linkTargets = resolveFieldTargetIdentifiers(
    field.options?.linkTargetContentTypeIds as Array<string | null> | undefined,
    undefined,
    idToIdentifier
  );
  if (embedTargets.length === 0 && linkTargets.length === 0) return null;
  return {
    embed: matchPools(embedTargets, idPools),
    link: matchPools(linkTargets, idPools),
  };
}

function matchPools(
  targetIds: string[],
  idPools: Map<string, RelationTargetPool>
): RichtextRefTarget[] {
  const out: RichtextRefTarget[] = [];
  for (const tid of targetIds) {
    const entry = idPools.get(tid);
    if (entry) {
      out.push({
        contentTypeId: entry.contentTypeId,
        contentTypeIdentifier: entry.contentTypeIdentifier,
        entryIds: entry.entryIds,
      });
    }
  }
  return out;
}

const DEFAULT_WINDOW_END_MS = Date.UTC(2026, 0, 1);
const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;

/**
 * Default DATETIME window for synthesised values when caller omits one.
 *
 * Anchored to a fixed wall-clock point (2026-01-01 UTC), NOT "now minus
 * 5 years". The window does not slide with time — generator output is
 * byte-identical across runs and across years, which is required for
 * the deterministic-output guarantee. If you need a sliding window,
 * pass `datetimeWindow` explicitly via GenerateOptions.
 */
function defaultWindow(): { from: Date; to: Date } {
  const to = new Date(DEFAULT_WINDOW_END_MS);
  const from = new Date(DEFAULT_WINDOW_END_MS - FIVE_YEARS_MS);
  return { from, to };
}
