import { describe, expect, it } from 'vitest';
import { topoSort, CycleRequiresNullError, type Edge } from './topoSort.js';

describe('topoSort', () => {
  it('handles a linear chain A → B → C', () => {
    const edges: Edge[] = [
      { from: 'B', to: 'A', field: 'a', required: false },
      { from: 'C', to: 'B', field: 'b', required: false },
    ];
    const r = topoSort(['A', 'B', 'C'], edges);
    expect(r.order).toEqual(['A', 'B', 'C']);
    expect(r.deferredEdges).toEqual([]);
  });

  it('handles a diamond (B and C both depend on A; D depends on both)', () => {
    const edges: Edge[] = [
      { from: 'B', to: 'A', field: 'a', required: false },
      { from: 'C', to: 'A', field: 'a', required: false },
      { from: 'D', to: 'B', field: 'b', required: false },
      { from: 'D', to: 'C', field: 'c', required: false },
    ];
    const r = topoSort(['A', 'B', 'C', 'D'], edges);
    expect(r.order[0]).toBe('A');
    expect(r.order[3]).toBe('D');
    expect(r.deferredEdges).toEqual([]);
  });

  it('defers an optional self-relation', () => {
    const edges: Edge[] = [
      { from: 'Page', to: 'Page', field: 'parent', required: false },
    ];
    const r = topoSort(['Page'], edges);
    expect(r.order).toEqual(['Page']);
    expect(r.deferredEdges).toEqual(edges);
  });

  it('throws on a required self-relation', () => {
    const edges: Edge[] = [
      { from: 'Page', to: 'Page', field: 'parent', required: true },
    ];
    expect(() => topoSort(['Page'], edges)).toThrow(CycleRequiresNullError);
  });

  it('defers one optional edge in a 2-node cycle', () => {
    const edges: Edge[] = [
      { from: 'A', to: 'B', field: 'b', required: false },
      { from: 'B', to: 'A', field: 'a', required: true },
    ];
    const r = topoSort(['A', 'B'], edges);
    // The required B → A edge stays; the optional A → B edge gets deferred.
    expect(r.deferredEdges).toEqual([
      { from: 'A', to: 'B', field: 'b', required: false },
    ]);
    expect(r.order).toEqual(['A', 'B']);
  });

  it('throws on a 2-node cycle with both edges required', () => {
    const edges: Edge[] = [
      { from: 'A', to: 'B', field: 'b', required: true },
      { from: 'B', to: 'A', field: 'a', required: true },
    ];
    expect(() => topoSort(['A', 'B'], edges)).toThrow(CycleRequiresNullError);
  });

  it('handles a 3-node cycle with one optional edge', () => {
    const edges: Edge[] = [
      { from: 'A', to: 'B', field: 'b', required: true },
      { from: 'B', to: 'C', field: 'c', required: false },
      { from: 'C', to: 'A', field: 'a', required: true },
    ];
    const r = topoSort(['A', 'B', 'C'], edges);
    expect(r.deferredEdges).toEqual([
      { from: 'B', to: 'C', field: 'c', required: false },
    ]);
  });

  it('throws on a 3-node cycle with all edges required', () => {
    const edges: Edge[] = [
      { from: 'A', to: 'B', field: 'b', required: true },
      { from: 'B', to: 'C', field: 'c', required: true },
      { from: 'C', to: 'A', field: 'a', required: true },
    ];
    expect(() => topoSort(['A', 'B', 'C'], edges)).toThrow(
      CycleRequiresNullError
    );
  });

  it('returns empty result for empty input', () => {
    const r = topoSort([], []);
    expect(r.order).toEqual([]);
    expect(r.deferredEdges).toEqual([]);
  });

  it('places identifiers with no edges in the order', () => {
    const r = topoSort(['Solo'], []);
    expect(r.order).toEqual(['Solo']);
    expect(r.deferredEdges).toEqual([]);
  });

  it('places multiple unrelated identifiers in input order', () => {
    const r = topoSort(['A', 'B', 'C'], []);
    expect(r.order).toEqual(['A', 'B', 'C']);
  });

  it('ignores edges that reference identifiers outside the input set', () => {
    const edges: Edge[] = [
      { from: 'A', to: 'GhostType', field: 'g', required: true },
      { from: 'OtherGhost', to: 'A', field: 'a', required: true },
    ];
    const r = topoSort(['A'], edges);
    expect(r.order).toEqual(['A']);
    expect(r.deferredEdges).toEqual([]);
  });

  it('is deterministic — same input twice produces identical output', () => {
    const edges: Edge[] = [
      { from: 'B', to: 'A', field: 'a', required: false },
      { from: 'C', to: 'A', field: 'a', required: false },
      { from: 'D', to: 'B', field: 'b', required: false },
      { from: 'D', to: 'C', field: 'c', required: false },
    ];
    const a = topoSort(['A', 'B', 'C', 'D'], edges);
    const b = topoSort(['A', 'B', 'C', 'D'], edges);
    expect(a.order).toEqual(b.order);
    expect(a.deferredEdges).toEqual(b.deferredEdges);
  });

  it('reports residual nodes via the residual field on the error', () => {
    const edges: Edge[] = [
      { from: 'A', to: 'B', field: 'b', required: true },
      { from: 'B', to: 'A', field: 'a', required: true },
    ];
    try {
      topoSort(['A', 'B'], edges);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CycleRequiresNullError);
      expect((err as CycleRequiresNullError).residual.sort()).toEqual([
        'A',
        'B',
      ]);
      expect((err as CycleRequiresNullError).requiredEdges).toEqual(edges);
    }
  });
});
