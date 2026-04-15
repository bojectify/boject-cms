# Starter Overlays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a compile-time overlay system that produces `sport.boject.json` and `rugby.boject.json` starter bundles by merging thin overlay files on top of an existing parent bundle.

**Architecture:** Overlay files live in `starters/src/*.overlay.json` and declare an `extends` target plus a list of content-type changes (either `mode: "create"` for new types or `mode: "patch"` for adding/replacing fields on a parent type). A build script (`scripts/build-starters/`) topo-sorts overlays, merges each against its resolved parent, validates with the existing `validateBundle`, and writes the full bundle to `starters/<name>.boject.json`. Outputs are committed; CI re-runs the build and fails on drift. Addresses [issue #24](https://github.com/ness-EE/boject-cms/issues/24).

**Tech Stack:** TypeScript (ESM, `tsx` for CLI execution), Vitest for tests. No Prisma, no Nuxt — pure filesystem + JSON.

---

## File Structure

**Create:**

- `scripts/build-starters/types.ts` — `Overlay`, `OverlayContentType`, `OverlayField` types.
- `scripts/build-starters/validate.ts` — overlay-specific shape validation.
- `scripts/build-starters/merge.ts` — `mergeOverlay(parent, overlay)` pure function.
- `scripts/build-starters/build.ts` — resolver (topo sort + `extends` chain), `buildAll(srcDir, outDir)`.
- `scripts/build-starters/index.ts` — CLI entry with `build` and `check` subcommands.
- `scripts/build-starters/validate.test.ts`
- `scripts/build-starters/merge.test.ts`
- `scripts/build-starters/build.test.ts`
- `starters/src/sport.overlay.json` — sport content types (delta from `base`).
- `starters/src/rugby.overlay.json` — rugby content types (delta from `sport`).
- `starters/sport.boject.json` — built output (committed).
- `starters/rugby.boject.json` — built output (committed).

**Modify:**

- `package.json` — add `starters:build` and `starters:check` scripts.
- `starters/README.md` — document overlay system, build command, authoring conventions.
- `CLAUDE.md` — document the overlay build system under the starter bundles section.

**Untouched:**

- `starters/base.boject.json` — stays authored directly (root bundle, no `extends`).
- `starters/starters.test.ts` — already validates every `*.boject.json` file; picks up new outputs automatically.
- `scripts/content-bundle/` — no changes; we reuse `validateBundle` and the `Bundle` types.

---

## Task 1: Overlay types

**Files:**

- Create: `scripts/build-starters/types.ts`

- [ ] **Step 1: Write the type definitions**

```typescript
// scripts/build-starters/types.ts
import type {
  Bundle,
  BundleContentType,
  BundleField,
} from '../content-bundle/types';

export const OVERLAY_VERSION = 1;

export type ContentTypeMode = 'create' | 'patch';

export interface OverlayField extends BundleField {}

export interface OverlayContentType {
  identifier: string;
  mode?: ContentTypeMode;
  name?: string;
  description?: string | null;
  fields: OverlayField[];
}

export interface Overlay {
  version: number;
  name: string;
  extends: string | null;
  contentTypes?: OverlayContentType[];
  entries?: Bundle['entries'];
}

export interface OverlayValidationError {
  path: string;
  message: string;
}

export interface OverlayValidationResult {
  ok: boolean;
  errors: OverlayValidationError[];
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/build-starters/types.ts
git commit -m "feat(starters): add overlay type definitions"
```

---

## Task 2: Overlay validator

**Files:**

- Create: `scripts/build-starters/validate.ts`
- Test: `scripts/build-starters/validate.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// scripts/build-starters/validate.test.ts
import { describe, expect, it } from 'vitest';
import { validateOverlay } from './validate';

const baseOverlay = {
  version: 1,
  name: 'sport',
  extends: 'base',
  contentTypes: [
    {
      identifier: 'Team',
      mode: 'create',
      name: 'Team',
      description: null,
      fields: [
        {
          id: null,
          identifier: 'name',
          name: 'Name',
          type: 'ENTRY_TITLE',
          required: true,
          order: 0,
          options: null,
        },
      ],
    },
  ],
};

describe('validateOverlay', () => {
  it('accepts a minimal valid overlay', () => {
    expect(validateOverlay(baseOverlay)).toEqual({ ok: true, errors: [] });
  });

  it('requires version 1', () => {
    const bad = { ...baseOverlay, version: 2 };
    const res = validateOverlay(bad);
    expect(res.ok).toBe(false);
    expect(res.errors[0].path).toBe('version');
  });

  it('requires a non-empty name', () => {
    const res = validateOverlay({ ...baseOverlay, name: '' });
    expect(res.ok).toBe(false);
    expect(res.errors.find((e) => e.path === 'name')).toBeDefined();
  });

  it('allows extends to be null (root bundle)', () => {
    const res = validateOverlay({ ...baseOverlay, extends: null });
    expect(res.ok).toBe(true);
  });

  it('requires extends to be string or null', () => {
    const res = validateOverlay({ ...baseOverlay, extends: 42 });
    expect(res.ok).toBe(false);
  });

  it('defaults mode to "create" and validates', () => {
    const ct = { ...baseOverlay.contentTypes[0] } as Record<string, unknown>;
    delete ct.mode;
    const res = validateOverlay({ ...baseOverlay, contentTypes: [ct] });
    expect(res.ok).toBe(true);
  });

  it('rejects unknown mode', () => {
    const ct = { ...baseOverlay.contentTypes[0], mode: 'replace' };
    const res = validateOverlay({ ...baseOverlay, contentTypes: [ct] });
    expect(res.ok).toBe(false);
  });

  it('requires name on create mode', () => {
    const ct = { ...baseOverlay.contentTypes[0] } as Record<string, unknown>;
    delete ct.name;
    const res = validateOverlay({ ...baseOverlay, contentTypes: [ct] });
    expect(res.ok).toBe(false);
    expect(res.errors.find((e) => e.path.endsWith('.name'))).toBeDefined();
  });

  it('allows patch mode without name', () => {
    const ct = {
      identifier: 'Player',
      mode: 'patch',
      fields: [
        {
          id: null,
          identifier: 'position',
          name: 'Position',
          type: 'RELATION',
          required: false,
          order: 10,
          options: {
            targetContentTypeIds: [null],
            targetContentTypeIdentifiers: ['Position'],
          },
        },
      ],
    };
    const res = validateOverlay({ ...baseOverlay, contentTypes: [ct] });
    expect(res.ok).toBe(true);
  });

  it('does NOT require exactly one ENTRY_TITLE in patch mode', () => {
    const ct = {
      identifier: 'Player',
      mode: 'patch',
      fields: [
        {
          id: null,
          identifier: 'position',
          name: 'Position',
          type: 'TEXT',
          required: false,
          order: 5,
          options: null,
        },
      ],
    };
    const res = validateOverlay({ ...baseOverlay, contentTypes: [ct] });
    expect(res.ok).toBe(true);
  });

  it('requires exactly one ENTRY_TITLE in create mode', () => {
    const ct = {
      identifier: 'Team',
      mode: 'create',
      name: 'Team',
      description: null,
      fields: [
        {
          id: null,
          identifier: 'slug',
          name: 'Slug',
          type: 'SLUG',
          required: false,
          order: 0,
          options: null,
        },
      ],
    };
    const res = validateOverlay({ ...baseOverlay, contentTypes: [ct] });
    expect(res.ok).toBe(false);
    expect(
      res.errors.find((e) => e.message.includes('ENTRY_TITLE'))
    ).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `pnpm vitest run scripts/build-starters/validate.test.ts`
Expected: FAIL — `validateOverlay` not found.

- [ ] **Step 3: Implement the validator**

```typescript
// scripts/build-starters/validate.ts
import type {
  Overlay,
  OverlayContentType,
  OverlayField,
  OverlayValidationError,
  OverlayValidationResult,
} from './types';
import { OVERLAY_VERSION } from './types';

const FIELD_TYPES = new Set([
  'ENTRY_TITLE',
  'SLUG',
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'BOOLEAN',
  'DATETIME',
  'SELECT',
  'RICHTEXT',
  'RELATION',
  'MULTIRELATION',
  'IMAGE',
]);

const MODES = new Set(['create', 'patch']);

export function validateOverlay(input: unknown): OverlayValidationResult {
  const errors: OverlayValidationError[] = [];

  if (!isObject(input)) {
    return {
      ok: false,
      errors: [{ path: '', message: 'overlay must be an object' }],
    };
  }

  const o = input as Partial<Overlay>;

  if (o.version !== OVERLAY_VERSION) {
    errors.push({
      path: 'version',
      message: `expected version ${OVERLAY_VERSION}, got ${o.version}`,
    });
  }

  if (typeof o.name !== 'string' || o.name.length === 0) {
    errors.push({ path: 'name', message: 'must be a non-empty string' });
  }

  if (o.extends !== null && typeof o.extends !== 'string') {
    errors.push({
      path: 'extends',
      message: 'must be a string (parent bundle name) or null',
    });
  }

  if (o.contentTypes !== undefined) {
    if (!Array.isArray(o.contentTypes)) {
      errors.push({ path: 'contentTypes', message: 'must be an array' });
    } else {
      o.contentTypes.forEach((ct, i) =>
        validateContentType(ct, `contentTypes[${i}]`, errors)
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

function validateContentType(
  ct: unknown,
  path: string,
  errors: OverlayValidationError[]
): void {
  if (!isObject(ct)) {
    errors.push({ path, message: 'must be an object' });
    return;
  }
  const c = ct as Partial<OverlayContentType>;
  const mode = c.mode ?? 'create';

  if (!MODES.has(mode)) {
    errors.push({
      path: `${path}.mode`,
      message: `must be one of ${Array.from(MODES).join(', ')}`,
    });
  }
  if (typeof c.identifier !== 'string' || c.identifier.length === 0) {
    errors.push({
      path: `${path}.identifier`,
      message: 'must be a non-empty string',
    });
  }
  if (mode === 'create') {
    if (typeof c.name !== 'string' || c.name.length === 0) {
      errors.push({
        path: `${path}.name`,
        message: 'create mode requires a non-empty name',
      });
    }
  }
  if (!Array.isArray(c.fields)) {
    errors.push({ path: `${path}.fields`, message: 'must be an array' });
    return;
  }

  if (mode === 'create') {
    const titleCount = c.fields.filter(
      (f) => isObject(f) && (f as OverlayField).type === 'ENTRY_TITLE'
    ).length;
    if (titleCount !== 1) {
      errors.push({
        path: `${path}.fields`,
        message: `create mode requires exactly one ENTRY_TITLE field, got ${titleCount}`,
      });
    }
  }

  c.fields.forEach((f, i) =>
    validateField(f, `${path}.fields[${i}]`, mode, errors)
  );
}

function validateField(
  field: unknown,
  path: string,
  mode: string,
  errors: OverlayValidationError[]
): void {
  if (!isObject(field)) {
    errors.push({ path, message: 'must be an object' });
    return;
  }
  const f = field as Partial<OverlayField>;

  if (typeof f.identifier !== 'string' || f.identifier.length === 0) {
    errors.push({
      path: `${path}.identifier`,
      message: 'must be a non-empty string',
    });
  }
  if (typeof f.type !== 'string' || !FIELD_TYPES.has(f.type)) {
    errors.push({
      path: `${path}.type`,
      message: `must be one of ${Array.from(FIELD_TYPES).join(', ')}`,
    });
    return;
  }
  if (mode === 'patch' && (f.type === 'ENTRY_TITLE' || f.type === 'SLUG')) {
    errors.push({
      path: `${path}.type`,
      message: `patch mode cannot introduce ${f.type} fields`,
    });
  }
  if (f.type === 'SELECT') {
    const choices = (f.options as { choices?: string[] } | null)?.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      errors.push({
        path: `${path}.options`,
        message: 'SELECT field requires a non-empty choices array',
      });
    }
  }
  if (f.type === 'RELATION' || f.type === 'MULTIRELATION') {
    const opts = f.options ?? {};
    const idents = (opts as { targetContentTypeIdentifiers?: unknown })
      .targetContentTypeIdentifiers;
    if (!Array.isArray(idents) || idents.length === 0) {
      errors.push({
        path: `${path}.options`,
        message: `${f.type} field requires targetContentTypeIdentifiers`,
      });
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `pnpm vitest run scripts/build-starters/validate.test.ts`
Expected: PASS (all 10 tests green).

- [ ] **Step 5: Commit**

```bash
git add scripts/build-starters/validate.ts scripts/build-starters/validate.test.ts
git commit -m "feat(starters): add overlay shape validator"
```

---

## Task 3: Merge engine

**Files:**

- Create: `scripts/build-starters/merge.ts`
- Test: `scripts/build-starters/merge.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// scripts/build-starters/merge.test.ts
import { describe, expect, it } from 'vitest';
import type { Bundle } from '../content-bundle/types';
import type { Overlay } from './types';
import { mergeOverlay } from './merge';

const parent: Bundle = {
  version: 1,
  exportedAt: '2026-04-15T00:00:00.000Z',
  portable: true,
  contentTypes: [
    {
      id: null,
      identifier: 'Player',
      name: 'Player',
      description: null,
      fields: [
        {
          id: null,
          identifier: 'name',
          name: 'Name',
          type: 'ENTRY_TITLE',
          required: true,
          order: 0,
          options: null,
        },
        {
          id: null,
          identifier: 'bio',
          name: 'Bio',
          type: 'TEXTAREA',
          required: false,
          order: 1,
          options: null,
        },
      ],
    },
  ],
  entries: [],
};

describe('mergeOverlay', () => {
  it('appends new content types in create mode', () => {
    const overlay: Overlay = {
      version: 1,
      name: 'sport',
      extends: 'base',
      contentTypes: [
        {
          identifier: 'Team',
          mode: 'create',
          name: 'Team',
          description: null,
          fields: [
            {
              id: null,
              identifier: 'name',
              name: 'Name',
              type: 'ENTRY_TITLE',
              required: true,
              order: 0,
              options: null,
            },
          ],
        },
      ],
    };
    const out = mergeOverlay(parent, overlay);
    expect(out.contentTypes?.map((c) => c.identifier)).toEqual([
      'Player',
      'Team',
    ]);
  });

  it('rejects create when identifier already exists in parent', () => {
    const overlay: Overlay = {
      version: 1,
      name: 'x',
      extends: 'base',
      contentTypes: [
        {
          identifier: 'Player',
          mode: 'create',
          name: 'Player',
          description: null,
          fields: [
            {
              id: null,
              identifier: 'name',
              name: 'Name',
              type: 'ENTRY_TITLE',
              required: true,
              order: 0,
              options: null,
            },
          ],
        },
      ],
    };
    expect(() => mergeOverlay(parent, overlay)).toThrow(
      /already exists.*Player/
    );
  });

  it('appends new fields in patch mode', () => {
    const overlay: Overlay = {
      version: 1,
      name: 'rugby',
      extends: 'sport',
      contentTypes: [
        {
          identifier: 'Player',
          mode: 'patch',
          fields: [
            {
              id: null,
              identifier: 'position',
              name: 'Position',
              type: 'RELATION',
              required: false,
              order: 10,
              options: {
                targetContentTypeIds: [null],
                targetContentTypeIdentifiers: ['Position'],
              },
            },
          ],
        },
      ],
    };
    const out = mergeOverlay(parent, overlay);
    const player = out.contentTypes!.find((c) => c.identifier === 'Player')!;
    expect(player.fields.map((f) => f.identifier)).toEqual([
      'name',
      'bio',
      'position',
    ]);
  });

  it('replaces existing fields wholesale when patch identifier collides', () => {
    const overlay: Overlay = {
      version: 1,
      name: 'x',
      extends: 'base',
      contentTypes: [
        {
          identifier: 'Player',
          mode: 'patch',
          fields: [
            {
              id: null,
              identifier: 'bio',
              name: 'Biography',
              type: 'RICHTEXT',
              required: true,
              order: 1,
              options: null,
            },
          ],
        },
      ],
    };
    const out = mergeOverlay(parent, overlay);
    const player = out.contentTypes!.find((c) => c.identifier === 'Player')!;
    const bio = player.fields.find((f) => f.identifier === 'bio')!;
    expect(bio.type).toBe('RICHTEXT');
    expect(bio.required).toBe(true);
    expect(bio.name).toBe('Biography');
  });

  it('rejects patch on missing content type', () => {
    const overlay: Overlay = {
      version: 1,
      name: 'x',
      extends: 'base',
      contentTypes: [
        {
          identifier: 'Ghost',
          mode: 'patch',
          fields: [],
        },
      ],
    };
    expect(() => mergeOverlay(parent, overlay)).toThrow(
      /Ghost.*not found in parent/
    );
  });

  it('does not mutate the parent bundle', () => {
    const overlay: Overlay = {
      version: 1,
      name: 'x',
      extends: 'base',
      contentTypes: [
        {
          identifier: 'Player',
          mode: 'patch',
          fields: [
            {
              id: null,
              identifier: 'height',
              name: 'Height',
              type: 'NUMBER',
              required: false,
              order: 5,
              options: null,
            },
          ],
        },
      ],
    };
    const before = JSON.stringify(parent);
    mergeOverlay(parent, overlay);
    expect(JSON.stringify(parent)).toBe(before);
  });

  it('updates exportedAt to current timestamp', () => {
    const overlay: Overlay = {
      version: 1,
      name: 'x',
      extends: 'base',
      contentTypes: [],
    };
    const before = new Date().toISOString();
    const out = mergeOverlay(parent, overlay);
    expect(out.exportedAt >= before).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `pnpm vitest run scripts/build-starters/merge.test.ts`
Expected: FAIL — `mergeOverlay` not found.

- [ ] **Step 3: Implement merge**

```typescript
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
      `Cannot create content type "${overlayCt.identifier}": already exists in parent bundle`
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
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `pnpm vitest run scripts/build-starters/merge.test.ts`
Expected: PASS (all 7 tests green).

- [ ] **Step 5: Commit**

```bash
git add scripts/build-starters/merge.ts scripts/build-starters/merge.test.ts
git commit -m "feat(starters): add overlay merge engine"
```

---

## Task 4: Build resolver + CLI

**Files:**

- Create: `scripts/build-starters/build.ts`
- Create: `scripts/build-starters/index.ts`
- Test: `scripts/build-starters/build.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests**

```typescript
// scripts/build-starters/build.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAll } from './build';

function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'starters-build-'));
  mkdirSync(join(root, 'src'));
  return root;
}

const baseBundle = {
  version: 1,
  exportedAt: '2026-04-15T00:00:00.000Z',
  portable: true,
  contentTypes: [
    {
      id: null,
      identifier: 'Image',
      name: 'Image',
      description: null,
      fields: [
        {
          id: null,
          identifier: 'name',
          name: 'Name',
          type: 'ENTRY_TITLE',
          required: true,
          order: 0,
          options: null,
        },
      ],
    },
  ],
  entries: [],
};

describe('buildAll', () => {
  let root: string;

  beforeEach(() => {
    root = makeWorkspace();
  });

  it('builds a single overlay extending base', () => {
    writeFileSync(join(root, 'base.boject.json'), JSON.stringify(baseBundle));
    writeFileSync(
      join(root, 'src', 'sport.overlay.json'),
      JSON.stringify({
        version: 1,
        name: 'sport',
        extends: 'base',
        contentTypes: [
          {
            identifier: 'Team',
            mode: 'create',
            name: 'Team',
            description: null,
            fields: [
              {
                id: null,
                identifier: 'name',
                name: 'Name',
                type: 'ENTRY_TITLE',
                required: true,
                order: 0,
                options: null,
              },
            ],
          },
        ],
      })
    );
    buildAll(root);
    const out = JSON.parse(
      readFileSync(join(root, 'sport.boject.json'), 'utf8')
    );
    expect(
      out.contentTypes.map((c: { identifier: string }) => c.identifier)
    ).toEqual(['Image', 'Team']);
  });

  it('builds chained overlays (rugby extends sport extends base)', () => {
    writeFileSync(join(root, 'base.boject.json'), JSON.stringify(baseBundle));
    writeFileSync(
      join(root, 'src', 'sport.overlay.json'),
      JSON.stringify({
        version: 1,
        name: 'sport',
        extends: 'base',
        contentTypes: [
          {
            identifier: 'Player',
            mode: 'create',
            name: 'Player',
            description: null,
            fields: [
              {
                id: null,
                identifier: 'name',
                name: 'Name',
                type: 'ENTRY_TITLE',
                required: true,
                order: 0,
                options: null,
              },
            ],
          },
        ],
      })
    );
    writeFileSync(
      join(root, 'src', 'rugby.overlay.json'),
      JSON.stringify({
        version: 1,
        name: 'rugby',
        extends: 'sport',
        contentTypes: [
          {
            identifier: 'Player',
            mode: 'patch',
            fields: [
              {
                id: null,
                identifier: 'position',
                name: 'Position',
                type: 'TEXT',
                required: false,
                order: 5,
                options: null,
              },
            ],
          },
        ],
      })
    );
    buildAll(root);
    const rugby = JSON.parse(
      readFileSync(join(root, 'rugby.boject.json'), 'utf8')
    );
    const player = rugby.contentTypes.find(
      (c: { identifier: string }) => c.identifier === 'Player'
    );
    expect(
      player.fields.map((f: { identifier: string }) => f.identifier)
    ).toEqual(['name', 'position']);
  });

  it('throws on cycle', () => {
    writeFileSync(join(root, 'base.boject.json'), JSON.stringify(baseBundle));
    writeFileSync(
      join(root, 'src', 'a.overlay.json'),
      JSON.stringify({ version: 1, name: 'a', extends: 'b', contentTypes: [] })
    );
    writeFileSync(
      join(root, 'src', 'b.overlay.json'),
      JSON.stringify({ version: 1, name: 'b', extends: 'a', contentTypes: [] })
    );
    expect(() => buildAll(root)).toThrow(/cycle/i);
  });

  it('throws on unknown parent', () => {
    writeFileSync(join(root, 'base.boject.json'), JSON.stringify(baseBundle));
    writeFileSync(
      join(root, 'src', 'orphan.overlay.json'),
      JSON.stringify({
        version: 1,
        name: 'orphan',
        extends: 'missing',
        contentTypes: [],
      })
    );
    expect(() => buildAll(root)).toThrow(/unknown parent.*missing/i);
  });

  it('validates each built bundle with validateBundle', () => {
    writeFileSync(join(root, 'base.boject.json'), JSON.stringify(baseBundle));
    writeFileSync(
      join(root, 'src', 'bad.overlay.json'),
      JSON.stringify({
        version: 1,
        name: 'bad',
        extends: 'base',
        contentTypes: [
          {
            identifier: 'Broken',
            mode: 'create',
            name: 'Broken',
            description: null,
            fields: [
              {
                id: null,
                identifier: 'f',
                name: 'F',
                type: 'SELECT',
                required: false,
                order: 0,
                options: null,
              },
            ],
          },
        ],
      })
    );
    expect(() => buildAll(root)).toThrow();
  });

  it('writes deterministic JSON (2-space indent, trailing newline)', () => {
    writeFileSync(join(root, 'base.boject.json'), JSON.stringify(baseBundle));
    writeFileSync(
      join(root, 'src', 'sport.overlay.json'),
      JSON.stringify({
        version: 1,
        name: 'sport',
        extends: 'base',
        contentTypes: [],
      })
    );
    buildAll(root, { now: '2026-04-15T12:00:00.000Z' });
    const content = readFileSync(join(root, 'sport.boject.json'), 'utf8');
    expect(content.endsWith('\n')).toBe(true);
    expect(content).toContain('  "version": 1');
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `pnpm vitest run scripts/build-starters/build.test.ts`
Expected: FAIL — `buildAll` not found.

- [ ] **Step 3: Implement `build.ts`**

```typescript
// scripts/build-starters/build.ts
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Bundle } from '../content-bundle/types';
import { validateBundle } from '../content-bundle/validate';
import { mergeOverlay } from './merge';
import type { Overlay } from './types';
import { validateOverlay } from './validate';

export interface BuildOptions {
  now?: string;
}

export interface BuildResult {
  name: string;
  path: string;
}

export function buildAll(root: string, opts: BuildOptions = {}): BuildResult[] {
  const srcDir = join(root, 'src');
  const overlayFiles = safeReaddir(srcDir).filter((f) =>
    f.endsWith('.overlay.json')
  );

  const overlays = new Map<string, Overlay>();
  for (const file of overlayFiles) {
    const raw = readFileSync(join(srcDir, file), 'utf8');
    const overlay = JSON.parse(raw) as Overlay;
    const result = validateOverlay(overlay);
    if (!result.ok) {
      throw new Error(
        `Invalid overlay ${file}:\n${formatErrors(result.errors)}`
      );
    }
    if (overlays.has(overlay.name)) {
      throw new Error(`Duplicate overlay name "${overlay.name}" in ${file}`);
    }
    overlays.set(overlay.name, overlay);
  }

  const ordered = topoSort(overlays);
  const results: BuildResult[] = [];

  for (const overlay of ordered) {
    const parent = loadParent(root, overlay.extends!, overlays, results);
    const merged = mergeOverlay(parent, overlay);
    if (opts.now) {
      merged.exportedAt = opts.now;
    }
    const validation = validateBundle(merged);
    if (!validation.ok) {
      throw new Error(
        `Built bundle "${overlay.name}" failed validation:\n${formatErrors(
          validation.errors
        )}`
      );
    }
    const outPath = join(root, `${overlay.name}.boject.json`);
    writeFileSync(outPath, JSON.stringify(merged, null, 2) + '\n');
    results.push({ name: overlay.name, path: outPath });
  }

  return results;
}

function loadParent(
  root: string,
  parentName: string,
  overlays: Map<string, Overlay>,
  built: BuildResult[]
): Bundle {
  const builtParent = built.find((r) => r.name === parentName);
  if (builtParent) {
    return JSON.parse(readFileSync(builtParent.path, 'utf8')) as Bundle;
  }
  const rootPath = join(root, `${parentName}.boject.json`);
  try {
    return JSON.parse(readFileSync(rootPath, 'utf8')) as Bundle;
  } catch {
    throw new Error(
      `unknown parent bundle "${parentName}" (expected ${rootPath} or a built overlay)`
    );
  }
}

function topoSort(overlays: Map<string, Overlay>): Overlay[] {
  const result: Overlay[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(name: string, stack: string[]): void {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(
        `cycle detected in overlay extends chain: ${stack.join(' -> ')} -> ${name}`
      );
    }
    visiting.add(name);
    const overlay = overlays.get(name);
    if (!overlay) return;
    if (overlay.extends && overlays.has(overlay.extends)) {
      visit(overlay.extends, [...stack, name]);
    }
    visiting.delete(name);
    visited.add(name);
    result.push(overlay);
  }

  for (const name of overlays.keys()) {
    visit(name, []);
  }
  return result;
}

function safeReaddir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function formatErrors(errors: { path: string; message: string }[]): string {
  return errors.map((e) => `  - ${e.path}: ${e.message}`).join('\n');
}
```

- [ ] **Step 4: Implement `index.ts` CLI**

```typescript
#!/usr/bin/env tsx
// scripts/build-starters/index.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildAll } from './build';

const DEFAULT_ROOT = resolve(process.cwd(), 'starters');

function main(): void {
  const [, , cmd = 'build', ...rest] = process.argv;
  const rootFlag = rest.find((a) => a.startsWith('--root='));
  const root = rootFlag
    ? resolve(process.cwd(), rootFlag.slice('--root='.length))
    : DEFAULT_ROOT;

  if (cmd === 'build') {
    const results = buildAll(root);
    for (const r of results) {
      console.log(`built ${r.name} -> ${r.path}`);
    }
    return;
  }

  if (cmd === 'check') {
    const overlayNames = getOverlayNames(root);
    const before = new Map<string, string>();
    for (const name of overlayNames) {
      const path = join(root, `${name}.boject.json`);
      try {
        before.set(name, readFileSync(path, 'utf8'));
      } catch {
        console.error(`missing built bundle for "${name}" at ${path}`);
        process.exit(1);
      }
    }
    buildAll(root);
    const drift: string[] = [];
    for (const name of overlayNames) {
      const path = join(root, `${name}.boject.json`);
      const after = readFileSync(path, 'utf8');
      if (after !== before.get(name)) {
        drift.push(name);
      }
    }
    if (drift.length > 0) {
      console.error(
        `Starter outputs are stale for: ${drift.join(', ')}. Run "pnpm starters:build" and commit.`
      );
      process.exit(1);
    }
    console.log('starters are up to date');
    return;
  }

  console.error(`unknown command: ${cmd}`);
  process.exit(1);
}

function getOverlayNames(root: string): string[] {
  return readdirSync(join(root, 'src'))
    .filter((f) => f.endsWith('.overlay.json'))
    .map((f) => f.replace(/\.overlay\.json$/, ''));
}

main();
```

- [ ] **Step 5: Add npm scripts**

Edit `package.json` — locate the `"scripts"` block and add after the existing `content:*` entries:

```json
    "starters:build": "tsx scripts/build-starters/index.ts build",
    "starters:check": "tsx scripts/build-starters/index.ts check",
```

- [ ] **Step 6: Run tests and confirm they pass**

Run: `pnpm vitest run scripts/build-starters/build.test.ts`
Expected: PASS (all 6 tests green).

- [ ] **Step 7: Smoke-test the CLI (no overlays exist yet — should be a no-op)**

Run: `pnpm starters:build`
Expected: exits 0 with no output (no `src/*.overlay.json` files yet).

- [ ] **Step 8: Commit**

```bash
git add scripts/build-starters/build.ts scripts/build-starters/build.test.ts scripts/build-starters/index.ts package.json
git commit -m "feat(starters): add overlay build CLI"
```

---

## Task 5: Author `sport.overlay.json`

**Files:**

- Create: `starters/src/sport.overlay.json`
- Generated: `starters/sport.boject.json`

Content types: Team, Club, Season, Competition, Fixture, Player.

- [ ] **Step 1: Write the sport overlay**

Write exactly:

```json
{
  "version": 1,
  "name": "sport",
  "extends": "base",
  "contentTypes": [
    {
      "identifier": "Team",
      "mode": "create",
      "name": "Team",
      "description": "An internal club squad (e.g. 1st XV, Veterans).",
      "fields": [
        {
          "id": null,
          "identifier": "name",
          "name": "Name",
          "type": "ENTRY_TITLE",
          "required": true,
          "order": 0,
          "options": null
        },
        {
          "id": null,
          "identifier": "slug",
          "name": "Slug",
          "type": "SLUG",
          "required": false,
          "order": 1,
          "options": null
        },
        {
          "id": null,
          "identifier": "description",
          "name": "Description",
          "type": "TEXTAREA",
          "required": false,
          "order": 2,
          "options": null
        }
      ]
    },
    {
      "identifier": "Club",
      "mode": "create",
      "name": "Club",
      "description": "An external opponent club.",
      "fields": [
        {
          "id": null,
          "identifier": "name",
          "name": "Name",
          "type": "ENTRY_TITLE",
          "required": true,
          "order": 0,
          "options": null
        },
        {
          "id": null,
          "identifier": "slug",
          "name": "Slug",
          "type": "SLUG",
          "required": false,
          "order": 1,
          "options": null
        },
        {
          "id": null,
          "identifier": "crest",
          "name": "Crest",
          "type": "RELATION",
          "required": false,
          "order": 2,
          "options": {
            "targetContentTypeIds": [null],
            "targetContentTypeIdentifiers": ["Image"]
          }
        }
      ]
    },
    {
      "identifier": "Season",
      "mode": "create",
      "name": "Season",
      "description": "A time-bounded competitive season.",
      "fields": [
        {
          "id": null,
          "identifier": "name",
          "name": "Name",
          "type": "ENTRY_TITLE",
          "required": true,
          "order": 0,
          "options": null
        },
        {
          "id": null,
          "identifier": "startDate",
          "name": "Start date",
          "type": "DATETIME",
          "required": true,
          "order": 1,
          "options": null
        },
        {
          "id": null,
          "identifier": "endDate",
          "name": "End date",
          "type": "DATETIME",
          "required": true,
          "order": 2,
          "options": null
        }
      ]
    },
    {
      "identifier": "Competition",
      "mode": "create",
      "name": "Competition",
      "description": "A league, cup, or tournament.",
      "fields": [
        {
          "id": null,
          "identifier": "name",
          "name": "Name",
          "type": "ENTRY_TITLE",
          "required": true,
          "order": 0,
          "options": null
        },
        {
          "id": null,
          "identifier": "slug",
          "name": "Slug",
          "type": "SLUG",
          "required": false,
          "order": 1,
          "options": null
        },
        {
          "id": null,
          "identifier": "season",
          "name": "Season",
          "type": "RELATION",
          "required": false,
          "order": 2,
          "options": {
            "targetContentTypeIds": [null],
            "targetContentTypeIdentifiers": ["Season"]
          }
        },
        {
          "id": null,
          "identifier": "teams",
          "name": "Teams",
          "type": "MULTIRELATION",
          "required": false,
          "order": 3,
          "options": {
            "targetContentTypeIds": [null],
            "targetContentTypeIdentifiers": ["Team"]
          }
        }
      ]
    },
    {
      "identifier": "Fixture",
      "mode": "create",
      "name": "Fixture",
      "description": "A scheduled or completed match.",
      "fields": [
        {
          "id": null,
          "identifier": "matchup",
          "name": "Matchup",
          "type": "ENTRY_TITLE",
          "required": true,
          "order": 0,
          "options": null
        },
        {
          "id": null,
          "identifier": "team",
          "name": "Team",
          "type": "RELATION",
          "required": true,
          "order": 1,
          "options": {
            "targetContentTypeIds": [null],
            "targetContentTypeIdentifiers": ["Team"]
          }
        },
        {
          "id": null,
          "identifier": "opponent",
          "name": "Opponent",
          "type": "RELATION",
          "required": false,
          "order": 2,
          "options": {
            "targetContentTypeIds": [null],
            "targetContentTypeIdentifiers": ["Club"]
          }
        },
        {
          "id": null,
          "identifier": "competition",
          "name": "Competition",
          "type": "RELATION",
          "required": false,
          "order": 3,
          "options": {
            "targetContentTypeIds": [null],
            "targetContentTypeIdentifiers": ["Competition"]
          }
        },
        {
          "id": null,
          "identifier": "season",
          "name": "Season",
          "type": "RELATION",
          "required": false,
          "order": 4,
          "options": {
            "targetContentTypeIds": [null],
            "targetContentTypeIdentifiers": ["Season"]
          }
        },
        {
          "id": null,
          "identifier": "kickoff",
          "name": "Kickoff",
          "type": "DATETIME",
          "required": true,
          "order": 5,
          "options": null
        },
        {
          "id": null,
          "identifier": "isHome",
          "name": "Home fixture",
          "type": "BOOLEAN",
          "required": false,
          "order": 6,
          "options": null
        }
      ]
    },
    {
      "identifier": "Player",
      "mode": "create",
      "name": "Player",
      "description": "An individual player profile.",
      "fields": [
        {
          "id": null,
          "identifier": "name",
          "name": "Name",
          "type": "ENTRY_TITLE",
          "required": true,
          "order": 0,
          "options": null
        },
        {
          "id": null,
          "identifier": "slug",
          "name": "Slug",
          "type": "SLUG",
          "required": false,
          "order": 1,
          "options": null
        },
        {
          "id": null,
          "identifier": "bio",
          "name": "Bio",
          "type": "TEXTAREA",
          "required": false,
          "order": 2,
          "options": null
        },
        {
          "id": null,
          "identifier": "headshot",
          "name": "Headshot",
          "type": "RELATION",
          "required": false,
          "order": 3,
          "options": {
            "targetContentTypeIds": [null],
            "targetContentTypeIdentifiers": ["Image"]
          }
        },
        {
          "id": null,
          "identifier": "team",
          "name": "Team",
          "type": "RELATION",
          "required": false,
          "order": 4,
          "options": {
            "targetContentTypeIds": [null],
            "targetContentTypeIdentifiers": ["Team"]
          }
        }
      ]
    }
  ]
}
```

- [ ] **Step 2: Build and inspect**

Run: `pnpm starters:build`
Expected output:

```
built sport -> /path/to/starters/sport.boject.json
```

- [ ] **Step 3: Run the starters test suite**

Run: `pnpm vitest run starters/starters.test.ts`
Expected: PASS — `sport.boject.json` is picked up automatically and validates.

- [ ] **Step 4: Commit**

```bash
git add starters/src/sport.overlay.json starters/sport.boject.json
git commit -m "feat(starters): add sport starter bundle"
```

---

## Task 6: Author `rugby.overlay.json`

**Files:**

- Create: `starters/src/rugby.overlay.json`
- Generated: `starters/rugby.boject.json`

Rugby adds a `Position` content type and patches `Player` to include a position relation.

- [ ] **Step 1: Write the rugby overlay**

```json
{
  "version": 1,
  "name": "rugby",
  "extends": "sport",
  "contentTypes": [
    {
      "identifier": "Position",
      "mode": "create",
      "name": "Position",
      "description": "A rugby playing position (e.g. Fly-half, Hooker).",
      "fields": [
        {
          "id": null,
          "identifier": "name",
          "name": "Name",
          "type": "ENTRY_TITLE",
          "required": true,
          "order": 0,
          "options": null
        },
        {
          "id": null,
          "identifier": "slug",
          "name": "Slug",
          "type": "SLUG",
          "required": false,
          "order": 1,
          "options": null
        },
        {
          "id": null,
          "identifier": "abbreviation",
          "name": "Abbreviation",
          "type": "TEXT",
          "required": false,
          "order": 2,
          "options": null
        }
      ]
    },
    {
      "identifier": "Player",
      "mode": "patch",
      "fields": [
        {
          "id": null,
          "identifier": "position",
          "name": "Position",
          "type": "RELATION",
          "required": false,
          "order": 10,
          "options": {
            "targetContentTypeIds": [null],
            "targetContentTypeIdentifiers": ["Position"]
          }
        }
      ]
    }
  ]
}
```

- [ ] **Step 2: Build and inspect**

Run: `pnpm starters:build`
Expected output (order may vary):

```
built sport -> /path/to/starters/sport.boject.json
built rugby -> /path/to/starters/rugby.boject.json
```

- [ ] **Step 3: Confirm the Player patch landed**

Run:

```bash
node -e "const b = require('./starters/rugby.boject.json'); const p = b.contentTypes.find(c => c.identifier === 'Player'); console.log(p.fields.map(f => f.identifier).join(','));"
```

Expected: `name,slug,bio,headshot,team,position`

- [ ] **Step 4: Run the starters test suite**

Run: `pnpm vitest run starters/starters.test.ts`
Expected: PASS — both new outputs validate.

- [ ] **Step 5: Run `starters:check`**

Run: `pnpm starters:check`
Expected: `starters are up to date` (exit 0).

- [ ] **Step 6: Commit**

```bash
git add starters/src/rugby.overlay.json starters/rugby.boject.json
git commit -m "feat(starters): add rugby starter bundle extending sport"
```

---

## Task 7: Drift test

**Files:**

- Create: `scripts/build-starters/drift.test.ts`

Guards against someone editing an overlay without rebuilding, or editing the built JSON directly.

- [ ] **Step 1: Write the test**

```typescript
// scripts/build-starters/drift.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildAll } from './build';

describe('starter outputs are up to date', () => {
  it('re-building produces byte-identical output', () => {
    const projectRoot = resolve(__dirname, '..', '..');
    const starters = join(projectRoot, 'starters');
    const tmp = mkdtempSync(join(tmpdir(), 'starters-drift-'));
    cpSync(starters, tmp, { recursive: true });

    // Capture committed outputs using the exportedAt already on disk,
    // then re-build in tmp with that same timestamp to isolate drift
    // from timestamp differences.
    const committedSport = JSON.parse(
      readFileSync(join(starters, 'sport.boject.json'), 'utf8')
    );
    buildAll(tmp, { now: committedSport.exportedAt });

    for (const name of ['sport', 'rugby']) {
      const committed = readFileSync(
        join(starters, `${name}.boject.json`),
        'utf8'
      );
      const rebuilt = readFileSync(join(tmp, `${name}.boject.json`), 'utf8');
      expect(rebuilt).toBe(committed);
    }
  });
});
```

- [ ] **Step 2: Run and confirm it passes**

Run: `pnpm vitest run scripts/build-starters/drift.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/build-starters/drift.test.ts
git commit -m "test(starters): guard against overlay/output drift"
```

---

## Task 8: Docs

**Files:**

- Modify: `starters/README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Read existing docs**

Read: `starters/README.md` (full contents) and `CLAUDE.md`. In `CLAUDE.md`, locate the existing line starting with `- **Starter bundles**` under the Architecture section and the existing `pnpm content:import` entry under the Commands section — these are the insertion points.

- [ ] **Step 2: Append to `starters/README.md`**

At the end of the file, add this new section verbatim (keep existing content untouched):

````markdown
## Overlay system

`base.boject.json` is authored directly. `sport.boject.json` and `rugby.boject.json` are **built** from small overlay files under `starters/src/` — they should not be edited by hand.

An overlay declares a parent bundle via `extends` and a list of content-type changes. Each change has a `mode`:

- `create` — add a brand-new content type. Fails if the identifier already exists in the parent chain. Requires `name` and exactly one `ENTRY_TITLE` field.
- `patch` — modify an existing content type. Fields are matched by `identifier`; matching fields are replaced wholesale (including their `type`); new fields are appended. New `ENTRY_TITLE`/`SLUG` fields cannot be introduced via patch.

### Build

```bash
pnpm starters:build   # read src/*.overlay.json, write *.boject.json outputs
pnpm starters:check   # rebuild in memory and diff against committed outputs (CI)
```

Overlays resolve their parent recursively. `rugby` extends `sport`, which extends `base`. Cycles and unknown parents are build-time errors. Every built output is validated with `validateBundle` before being written.

Build outputs are committed so `pnpm content:import starters/sport.boject.json` works without a prior build step.

### Layout

```
starters/
  base.boject.json           # authored directly
  sport.boject.json          # built
  rugby.boject.json          # built
  src/
    sport.overlay.json
    rugby.overlay.json
```

### Overlay shape

```json
{
  "version": 1,
  "name": "sport",
  "extends": "base",
  "contentTypes": [
    {
      "identifier": "Team",
      "mode": "create",
      "name": "Team",
      "description": null,
      "fields": [
        /* BundleField[] */
      ]
    },
    {
      "identifier": "Player",
      "mode": "patch",
      "fields": [
        /* fields to add or replace */
      ]
    }
  ]
}
```
````

- [ ] **Step 3: Update `CLAUDE.md` — Architecture entry**

Find the existing line (single bullet, starts with `- **Starter bundles**`). Immediately **after** that bullet, insert this new bullet as a sibling:

```markdown
- **Starter overlays** — `starters/base.boject.json` is authored directly. `sport.boject.json` and `rugby.boject.json` are built from `starters/src/*.overlay.json` via `pnpm starters:build`. Each overlay declares an `extends` parent and a list of content-type changes with `mode: "create"` (append a new type) or `mode: "patch"` (add/replace fields on a parent type; new ENTRY_TITLE/SLUG fields are rejected). The build script resolves the `extends` chain (topo-sorted, cycles error out), runs `validateBundle` on every output, and writes deterministic 2-space JSON so `pnpm starters:check` can diff against committed outputs in CI. Build outputs are committed.
```

- [ ] **Step 4: Update `CLAUDE.md` — Commands block**

Find the existing line `pnpm content:validate <path>` inside the fenced ```bash block near the top. Immediately **after** that line, insert:

```bash
pnpm starters:build           # Build sport.boject.json / rugby.boject.json from overlays in starters/src/
pnpm starters:check           # Verify committed starter outputs are up to date (CI)
```

- [ ] **Step 5: Update `CLAUDE.md` — Key Files list**

Find the existing entry `- \`starters/README.md\` — starter bundle documentation + usage conventions`. Immediately **after** that entry, insert these bullets as siblings:

```markdown
- `scripts/build-starters/types.ts` — `Overlay`, `OverlayContentType`, `OverlayField` types
- `scripts/build-starters/validate.ts` — overlay-specific shape validator (separate from `validateBundle`; allows patch mode to omit ENTRY_TITLE)
- `scripts/build-starters/merge.ts` — pure `mergeOverlay(parent, overlay)` function implementing create/patch semantics
- `scripts/build-starters/build.ts` — `buildAll(root)` orchestrator (topo-sort + per-overlay merge + validate + write)
- `scripts/build-starters/index.ts` — `pnpm starters:build` / `pnpm starters:check` CLI entry
- `starters/src/sport.overlay.json` — sport content types (Team, Club, Season, Competition, Fixture, Player) as a delta on top of `base`
- `starters/src/rugby.overlay.json` — rugby content types (Position + Player patch) as a delta on top of `sport`
```

- [ ] **Step 6: Run lint/format to tidy**

Run: `pnpm lint:fix && pnpm format:fix`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add starters/README.md CLAUDE.md
git commit -m "docs(starters): document overlay build system"
```

---

## Final verification

- [ ] **Run the full relevant test suite**

Run: `pnpm vitest run scripts/build-starters starters`
Expected: all tests PASS.

- [ ] **Run the whole project typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Smoke-test an import**

Run: `pnpm content:validate starters/rugby.boject.json`
Expected: bundle is valid.

- [ ] **Open the PR**

Reference issue #24 in the PR description. Note that removal of the hardcoded rugby Prisma models is tracked as a follow-up task.
