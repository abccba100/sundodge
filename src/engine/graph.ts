import Flatbush from 'flatbush';
import type { Graph } from './types';

export interface WayInput {
  kind: string;
  /** Local coordinates of each vertex, flattened [x0, y0, x1, y1, ...]. */
  coords: number[];
  /** Stable id per vertex (OSM node id) so ways that share a node connect. */
  ids: number[];
  /** Tunnel, arcade or indoor passage: never in direct sun. */
  covered?: boolean;
}

export function buildGraph(ways: WayInput[]): Graph {
  const idToIdx = new Map<number, number>();
  const xs: number[] = [];
  const ys: number[] = [];
  const ea: number[] = [];
  const eb: number[] = [];
  const el: number[] = [];
  const ek: string[] = [];
  const ec: number[] = [];
  const nodeOf = (id: number, x: number, y: number) => {
    let i = idToIdx.get(id);
    if (i === undefined) {
      i = xs.length;
      idToIdx.set(id, i);
      xs.push(x);
      ys.push(y);
    }
    return i;
  };
  for (const w of ways) {
    let prev = -1;
    for (let k = 0; k < w.ids.length; k++) {
      const cur = nodeOf(w.ids[k], w.coords[2 * k], w.coords[2 * k + 1]);
      if (prev >= 0 && prev !== cur) {
        const len = Math.hypot(xs[cur] - xs[prev], ys[cur] - ys[prev]);
        if (len > 0.01) {
          ea.push(prev); eb.push(cur); el.push(len); ek.push(w.kind); ec.push(w.covered ? 1 : 0);
        }
      }
      prev = cur;
    }
  }
  const n = xs.length;
  const deg = new Int32Array(n + 1);
  for (let e = 0; e < ea.length; e++) { deg[ea[e] + 1]++; deg[eb[e] + 1]++; }
  for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
  const adjStart = deg;
  const fill = adjStart.slice(0, n);
  const adjTo = new Int32Array(ea.length * 2);
  const adjEdge = new Int32Array(ea.length * 2);
  for (let e = 0; e < ea.length; e++) {
    adjTo[fill[ea[e]]] = eb[e]; adjEdge[fill[ea[e]]++] = e;
    adjTo[fill[eb[e]]] = ea[e]; adjEdge[fill[eb[e]]++] = e;
  }
  const g: Graph = {
    nodeX: Float64Array.from(xs),
    nodeY: Float64Array.from(ys),
    adjStart, adjTo, adjEdge,
    edgeA: Int32Array.from(ea),
    edgeB: Int32Array.from(eb),
    edgeLen: Float64Array.from(el),
    edgeKind: ek,
    edgeCovered: Uint8Array.from(ec),
    nodeInMain: new Uint8Array(n),
  };
  markMainComponent(g);
  return g;
}

function markMainComponent(g: Graph) {
  const n = g.nodeX.length;
  const comp = new Int32Array(n).fill(-1);
  let best = -1, bestSize = 0, c = 0;
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0) continue;
    let size = 0;
    stack.push(s); comp[s] = c;
    while (stack.length) {
      const u = stack.pop()!;
      size++;
      for (let k = g.adjStart[u]; k < g.adjStart[u + 1]; k++) {
        const v = g.adjTo[k];
        if (comp[v] < 0) { comp[v] = c; stack.push(v); }
      }
    }
    if (size > bestSize) { bestSize = size; best = c; }
    c++;
  }
  for (let i = 0; i < n; i++) g.nodeInMain[i] = comp[i] === best ? 1 : 0;
}

export class NodeLocator {
  private index: Flatbush;
  private ids: number[];
  constructor(g: Graph) {
    this.ids = [];
    for (let i = 0; i < g.nodeX.length; i++) if (g.nodeInMain[i]) this.ids.push(i);
    this.index = new Flatbush(Math.max(1, this.ids.length));
    if (!this.ids.length) this.index.add(0, 0, 0, 0);
    for (const i of this.ids) this.index.add(g.nodeX[i], g.nodeY[i], g.nodeX[i], g.nodeY[i]);
    this.index.finish();
  }
  nearest(x: number, y: number): number {
    if (!this.ids.length) return -1;
    const [k] = this.index.neighbors(x, y, 1);
    return k === undefined ? -1 : this.ids[k];
  }
}

export interface PathResult {
  nodes: number[];
  edges: number[];
  cost: number;
}

/** Dijkstra with a binary heap. edgeCost(e) must be >= 0. */
export function shortestPath(g: Graph, src: number, dst: number, edgeCost: (e: number) => number): PathResult | null {
  const n = g.nodeX.length;
  if (src < 0 || dst < 0 || src >= n || dst >= n) return null;
  const dist = new Float64Array(n).fill(Infinity);
  const prevEdge = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap = new MinHeap();
  dist[src] = 0;
  heap.push(src, 0);
  while (heap.size) {
    const u = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === dst) break;
    for (let k = g.adjStart[u]; k < g.adjStart[u + 1]; k++) {
      const v = g.adjTo[k];
      if (done[v]) continue;
      const e = g.adjEdge[k];
      const nd = dist[u] + edgeCost(e);
      if (nd < dist[v]) { dist[v] = nd; prevEdge[v] = e; heap.push(v, nd); }
    }
  }
  if (!Number.isFinite(dist[dst])) return null;
  const nodes = [dst];
  const edges: number[] = [];
  let cur = dst;
  while (cur !== src) {
    const e = prevEdge[cur];
    edges.push(e);
    cur = g.edgeA[e] === cur ? g.edgeB[e] : g.edgeA[e];
    nodes.push(cur);
  }
  nodes.reverse();
  edges.reverse();
  return { nodes, edges, cost: dist[dst] };
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, key: number) {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id); keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p]; keys[i] = keys[p];
      i = p;
    }
    ids[i] = id; keys[i] = key;
  }
  pop(): number {
    const ids = this.ids, keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop()!, lastKey = keys.pop()!;
    const n = ids.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c]; keys[i] = keys[c];
        i = c;
      }
      ids[i] = lastId; keys[i] = lastKey;
    }
    return top;
  }
}
