export interface Edge {
  /** Identifier of the dependent type (the one that needs `to` to exist first) */
  from: string;
  /** Identifier of the target type */
  to: string;
  /** Field identifier on `from` that creates the dependency */
  field: string;
  /** Required field on `from` */
  required: boolean;
}

export interface TopoSortResult {
  /** Type identifiers in dependency-safe insertion order */
  order: string[];
  /** Edges that were deferred to break cycles — writers apply via post-insert patches */
  deferredEdges: Edge[];
}

export class CycleRequiresNullError extends Error {
  /**
   * The set of nodes that remained when the algorithm got stuck.
   * This is a *superset* of the actual cycle — it includes any node
   * that was waiting on the cycle, transitively. The `requiredEdges`
   * field is the precise set of edges that prevented further progress.
   */
  public residual: string[];
  public requiredEdges: Edge[];

  constructor(residual: string[], requiredEdges: Edge[]) {
    super(
      `Stuck on residual nodes [${residual.join(', ')}]: cycle through them ` +
        `has only required edges; cannot defer. Make at least one edge ` +
        `optional. Required edges: ${requiredEdges
          .map((e) => `${e.from}.${e.field} → ${e.to}`)
          .join(', ')}`
    );
    this.name = 'CycleRequiresNullError';
    this.residual = residual;
    this.requiredEdges = requiredEdges;
  }
}

/**
 * Kahn-style topological sort with cycle deferral.
 *
 * Builds the graph from `edges`, then repeatedly picks any node whose remaining
 * out-edges to other remaining nodes are zero (i.e. its targets have already
 * been placed). When stuck (a cycle remains), looks for an optional edge inside
 * the remaining subgraph; defers it (records to `deferredEdges`) and continues.
 * If no optional edge exists in any remaining cycle, throws.
 */
export function topoSort(identifiers: string[], edges: Edge[]): TopoSortResult {
  const remainingEdges = [...edges];
  const order: string[] = [];
  const deferredEdges: Edge[] = [];
  const remainingNodes = new Set(identifiers);

  while (remainingNodes.size > 0) {
    // Pick any node with no outbound edges to other remaining nodes.
    // Such a node depends only on already-placed targets and can be emitted next.
    const ready = [...remainingNodes].find(
      (n) =>
        !remainingEdges.some((e) => e.from === n && remainingNodes.has(e.to))
    );

    if (ready) {
      order.push(ready);
      remainingNodes.delete(ready);
      // Remove edges originating from this node (it's been placed).
      for (let i = remainingEdges.length - 1; i >= 0; i--) {
        if (remainingEdges[i]!.from === ready) remainingEdges.splice(i, 1);
      }
      continue;
    }

    // Stuck — there's a cycle among remainingNodes. Find an optional edge to defer.
    const cycleEdges = remainingEdges.filter(
      (e) => remainingNodes.has(e.from) && remainingNodes.has(e.to)
    );
    const optional = cycleEdges.find((e) => !e.required);
    if (!optional) {
      throw new CycleRequiresNullError(
        [...remainingNodes],
        cycleEdges.filter((e) => e.required)
      );
    }
    deferredEdges.push(optional);
    const idx = remainingEdges.indexOf(optional);
    remainingEdges.splice(idx, 1);
  }

  return { order, deferredEdges };
}
