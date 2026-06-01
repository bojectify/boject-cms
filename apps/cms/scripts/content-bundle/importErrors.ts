import type { ValidationError } from './types';

/** Bundle failed shape validation before any DB work. Maps to HTTP 400. */
export class BundleImportValidationError extends Error {
  // Intentionally shares the 'BUNDLE_INVALID' code with SchemaApplyValidationError
  // (applySchemaErrors.ts): both map to HTTP 400 but live in separate flows
  // (entry-import vs schema-apply), so no single endpoint switch ever sees both.
  readonly code = 'BUNDLE_INVALID' as const;
  constructor(readonly errors: ValidationError[]) {
    super(
      `Bundle failed validation:\n${errors
        .map((e) => `  ${e.path}: ${e.message}`)
        .join('\n')}`
    );
    this.name = 'BundleImportValidationError';
  }
}

/** An entry collided with an existing one under onConflict: 'fail'. HTTP 409. */
export class EntryImportConflictError extends Error {
  readonly code = 'ENTRY_IMPORT_CONFLICT' as const;
  constructor(
    message: string,
    readonly contentTypeIdentifier: string,
    readonly entryKey: string
  ) {
    super(message);
    this.name = 'EntryImportConflictError';
  }
}

/**
 * A bundle reference (content-type identifier on an entry or a RELATION
 * field target) could not be resolved on the target. HTTP 400.
 */
export class EntryImportReferenceError extends Error {
  readonly code = 'ENTRY_IMPORT_REFERENCE_INVALID' as const;
  constructor(message: string) {
    super(message);
    this.name = 'EntryImportReferenceError';
  }
}
