// scripts/build-starters/merge.ts
import type {
  Bundle,
  BundleContentType,
  BundleField,
} from '../content-bundle/types';
import type { Overlay, OverlayContentType } from './types';

export function mergeOverlay(parent: Bundle, overlay: Overlay): Bundle {
  const out: Bundle = {
    version: parent.version,
    exportedAt: new Date().toISOString(),
    portable: parent.portable,
    contentTypes: (parent.contentTypes ?? []).map(cloneContentType),
    entries: [...(parent.entries ?? [])],
  };

  for (const overlayCt of overlay.contentTypes ?? []) {
    const mode = overlayCt.mode ?? 'create';
    if (mode === 'create') {
      applyCreate(out, overlayCt);
    } else {
      applyPatch(out, overlayCt);
    }
  }

  for (const entry of overlay.entries ?? []) {
    out.entries!.push({ ...entry });
  }

  return out;
}

function applyCreate(bundle: Bundle, overlayCt: OverlayContentType): void {
  const existing = bundle.contentTypes!.find(
    (c) => c.identifier === overlayCt.identifier
  );
  if (existing) {
    throw new Error(
      `Content type already exists in parent bundle: ${overlayCt.identifier}`
    );
  }
  bundle.contentTypes!.push({
    id: null,
    identifier: overlayCt.identifier,
    name: overlayCt.name!,
    description: overlayCt.description ?? null,
    fields: overlayCt.fields.map(cloneField),
  });
}

function applyPatch(bundle: Bundle, overlayCt: OverlayContentType): void {
  const target = bundle.contentTypes!.find(
    (c) => c.identifier === overlayCt.identifier
  );
  if (!target) {
    throw new Error(
      `Cannot patch content type "${overlayCt.identifier}": not found in parent bundle`
    );
  }
  for (const field of overlayCt.fields) {
    const existingIndex = target.fields.findIndex(
      (f) => f.identifier === field.identifier
    );
    if (existingIndex === -1) {
      target.fields.push(cloneField(field));
      continue;
    }
    target.fields[existingIndex] = cloneField(field);
  }
}

export function composeParents(parents: Bundle[]): Bundle {
  const first = parents[0];
  const out: Bundle = {
    version: first?.version ?? 2,
    exportedAt: new Date().toISOString(),
    portable: first?.portable ?? true,
    contentTypes: [],
    entries: [],
  };
  const seen = new Set<string>();
  for (const parent of parents) {
    for (const ct of parent.contentTypes ?? []) {
      if (seen.has(ct.identifier)) {
        throw new Error(
          `Duplicate content type "${ct.identifier}" across extended bundles`
        );
      }
      seen.add(ct.identifier);
      out.contentTypes!.push(cloneContentType(ct));
    }
    for (const entry of parent.entries ?? []) {
      out.entries!.push({ ...entry });
    }
  }
  return out;
}

function cloneContentType(ct: BundleContentType): BundleContentType {
  return {
    id: ct.id,
    identifier: ct.identifier,
    name: ct.name,
    description: ct.description,
    fields: ct.fields.map(cloneField),
  };
}

function cloneField(f: BundleField): BundleField {
  return {
    id: f.id,
    identifier: f.identifier,
    name: f.name,
    type: f.type,
    required: f.required,
    order: f.order,
    options: f.options ? JSON.parse(JSON.stringify(f.options)) : null,
  };
}
