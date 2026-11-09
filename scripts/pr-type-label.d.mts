// Types for scripts/pr-type-label.mjs (kept as plain ESM so the PR-labels
// workflow can import it with no build step).
export declare const TYPE_LABELS: ReadonlySet<string>;
export declare function labelForTitle(title: string): string | null;
