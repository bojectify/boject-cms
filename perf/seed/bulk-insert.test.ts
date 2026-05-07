import { describe, expect, it } from 'vitest';
import { seedPerfData } from './bulk-insert';

describe('seedPerfData (workspace wrapper)', () => {
  it('exports a function with the expected signature', () => {
    // The wrapper is a thin pass-through to @boject/cli/perf. Smoke
    // coverage lives in `pnpm perf:sweep`. This test stays minimal:
    // assert the wrapper exists and exports the expected interface.
    expect(typeof seedPerfData).toBe('function');
    expect(seedPerfData.length).toBe(1); // accepts one arg (opts object)
  });
});
