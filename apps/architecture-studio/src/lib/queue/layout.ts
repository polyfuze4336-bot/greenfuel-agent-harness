// Lays out the "what blocks the build" graph in columns: the build on the right, and the work it needs further to the left.
// Pure arithmetic over node ids and depths, so it is deterministic and testable. Not a general graph drawing library.
export interface LayoutNode {
  id: string;
  depth: number;
  unlocks: number;
}

export interface Placed {
  id: string;
  x: number;
  y: number;
  column: number;
}

export interface Layout {
  nodes: Placed[];
  width: number;
  height: number;
  nodeW: number;
  nodeH: number;
}

export function layoutColumns(nodes: LayoutNode[], opts: { nodeW?: number; nodeH?: number; gapX?: number; gapY?: number } = {}): Layout {
  const nodeW = opts.nodeW ?? 230;
  const nodeH = opts.nodeH ?? 46;
  const gapX = opts.gapX ?? 80;
  const gapY = opts.gapY ?? 12;
  const maxDepth = Math.max(0, ...nodes.map((n) => n.depth));
  const columns = new Map<number, LayoutNode[]>();
  for (const n of nodes) columns.set(n.depth, [...(columns.get(n.depth) ?? []), n]);
  const placed: Placed[] = [];
  let tallest = 0;
  for (const [depth, col] of columns) {
    col.sort((a, b) => b.unlocks - a.unlocks || a.id.localeCompare(b.id, undefined, { numeric: true }));
    col.forEach((n, i) => placed.push({ id: n.id, x: (maxDepth - depth) * (nodeW + gapX), y: i * (nodeH + gapY), column: maxDepth - depth }));
    tallest = Math.max(tallest, col.length);
  }
  return { nodes: placed, width: (maxDepth + 1) * nodeW + maxDepth * gapX, height: Math.max(1, tallest) * (nodeH + gapY) - gapY, nodeW, nodeH };
}
