import { validateBundle } from './vendor/validateBundle.js';
import { planSchema } from './vendor/planSchema.js';
import type { Bundle } from './vendor/contentBundleTypes.js';
import type { CurrentSchemaSnapshot } from './vendor/schemaPlan.types.js';

export interface SchemaIssue {
  path: string;
  message: string;
  kind: 'shape' | 'plan';
  code?: string;
}

export interface SchemaValidation {
  ok: boolean;
  issues: SchemaIssue[];
}

const EMPTY_SNAPSHOT: CurrentSchemaSnapshot = {
  contentTypes: [],
  fieldUsage: new Map(),
};

/**
 * Offline schema validation shared by `boject schema validate` and the MCP
 * `validate_schema` tool. Mirrors the CLI's two-step: bundle-shape checks
 * (validateBundle), then cross-reference blockers (planSchema against an
 * empty snapshot). The planner only runs when the shape is valid.
 */
export function validateSchemaBundle(input: unknown): SchemaValidation {
  const issues: SchemaIssue[] = [];

  const shape = validateBundle(input);
  for (const e of shape.errors) {
    issues.push({ path: e.path, message: e.message, kind: 'shape' });
  }

  if (shape.ok) {
    const plan = planSchema(input as Bundle, EMPTY_SNAPSHOT, {});
    for (const b of plan.blockers) {
      issues.push({
        path: b.path,
        message: b.message,
        kind: 'plan',
        code: b.code,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}
