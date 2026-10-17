import type { Area, Graph } from './types';
import { ShadowField } from './shadow';
import { sunAt } from './sun';
import { NodeLocator, shortestPath } from './graph';
import type { Projection } from './project';

/** Default walking speed, m/s (about 4.5 km/h). */
export const WALK_SPEED = 1.25;

/**
 * Samples points along every street edge and measures what fraction of
 * each edge is in direct sun at a given moment.
 */
export class EdgeSampler {
  readonly sx: Float64Array;
  readonly sy: Float64Array;
  readonly start: Int32Array;
  readonly g: Graph;
  constructor(g: Graph, spacing = 4) {
    this.g = g;
    const m = g.edgeLen.length;
    const start = new Int32Array(m + 1);
    for (let e = 0; e < m; e++) start[e + 1] = start[e] + Math.max(1, Math.ceil(g.edgeLen[e] / spacing));
    const total = start[m];
    this.sx = new Float64Array(total);
    this.sy = new Float64Array(total);
    for (let e = 0; e < m; e++) {
      const a = g.edgeA[e], b = g.edgeB[e];
      const n = start[e + 1] - start[e];
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        this.sx[start[e] + k] = g.nodeX[a] + (g.nodeX[b] - g.nodeX[a]) * t;
        this.sy[start[e] + k] = g.nodeY[a] + (g.nodeY[b] - g.nodeY[a]) * t;
      }
    }
    this.start = start;
  }

  /** Returns per-edge fraction in sun, and per-edge fraction under trees. */
  measure(field: ShadowField): { sun: Float32Array; tree: Float32Array } {
    const m = this.g.edgeLen.length;
    const sun = new Float32Array(m);
    const tree = new Float32Array(m);
    if (field.night) return { sun, tree };
    for (let e = 0; e < m; e++) {
      if (this.g.edgeCovered[e]) continue;
      const s0 = this.start[e], s1 = this.start[e + 1];
      let lit = 0, tr = 0;
      for (let k = s0; k < s1; k++) {
        const s = field.shadeAt(this.sx[k], this.sy[k]);
        if (s === 0) lit++;
        else if (s === 2) tr++;
      }
      sun[e] = lit / (s1 - s0);
      tree[e] = tr / (s1 - s0);
    }
    return { sun, tree };
  }
}

export interface RouteResult {
  edges: number[];
  nodes: number[];
  lengthM: number;
  minutes: number;
  sunM: number;
  sunMinutes: number;
  treeM: number;
  /** Metres on covered ways (arcades, covered alleys, underground or indoor passages). */
  coveredM: number;
  shadePct: number;
}

export interface Snapshot {
  time: Date;
  field: ShadowField;
  sun: Float32Array;
  tree: Float32Array;
}

export class Planner {
  readonly sampler: EdgeSampler;
  readonly locator: NodeLocator;
  private cache = new Map<number, Snapshot>();
  readonly area: Area;
  readonly proj: Projection;

  constructor(area: Area, proj: Projection) {
    this.area = area;
    this.proj = proj;
    this.sampler = new EdgeSampler(area.graph);
    this.locator = new NodeLocator(area.graph);
  }

  snapshot(time: Date): Snapshot {
    const key = Math.round(time.getTime() / 60000);
    const hit = this.cache.get(key);
    if (hit) return hit;
    const s = sunAt(time, this.area.center[1], this.area.center[0]);
    const field = new ShadowField(this.area.buildings, this.area.trees, s);
    const { sun, tree } = this.sampler.measure(field);
    const snap = { time, field, sun, tree };
    if (this.cache.size > 64) this.cache.clear();
    this.cache.set(key, snap);
    return snap;
  }

  nearestNode(lng: number, lat: number): number {
    const [x, y] = this.proj.toXY(lng, lat);
    return this.locator.nearest(x, y);
  }

  /**
   * Route cost follows the CoolWalks model (Wolf, Vierø, Szell): a metre in
   * shade costs 1 and a metre in sun costs alpha. alpha = 1 is the plain
   * shortest path.
   */
  route(src: number, dst: number, snap: Snapshot, alpha: number): RouteResult | null {
    const g = this.area.graph;
    const sun = snap.sun;
    const p = shortestPath(g, src, dst, (e) => g.edgeLen[e] * (1 - sun[e]) + alpha * g.edgeLen[e] * sun[e]);
    if (!p) return null;
    return this.measureRoute(p.edges, p.nodes, snap);
  }

  measureRoute(edges: number[], nodes: number[], snap: Snapshot): RouteResult {
    const g = this.area.graph;
    let len = 0, sunM = 0, treeM = 0, coveredM = 0;
    for (const e of edges) {
      len += g.edgeLen[e];
      sunM += g.edgeLen[e] * snap.sun[e];
      treeM += g.edgeLen[e] * snap.tree[e];
      if (g.edgeCovered[e]) coveredM += g.edgeLen[e];
    }
    return {
      edges, nodes,
      lengthM: len,
      minutes: len / WALK_SPEED / 60,
      sunM,
      sunMinutes: sunM / WALK_SPEED / 60,
      treeM,
      coveredM,
      shadePct: len > 0 ? (1 - sunM / len) * 100 : 100,
    };
  }

  /**
   * Shadows are evaluated at the middle of the walk, not at the door:
   * for a 10-20 minute walk this keeps the error small without a
   * time-dependent search.
   */
  compare(src: number, dst: number, depart: Date, alpha: number, shortestPathHint?: { edges: number[]; nodes: number[] } | null) {
    // The shortest route does not depend on the sun (alpha = 1 costs plain length), so no
    // shadow snapshot is needed to find it.
    const g = this.area.graph;
    const p = shortestPathHint ?? shortestPath(g, src, dst, (e) => g.edgeLen[e]);
    if (!p) return null;
    let lengthM = 0;
    for (const e of p.edges) lengthM += g.edgeLen[e];
    const mid = new Date(depart.getTime() + (lengthM / WALK_SPEED / 60 / 2) * 60000);
    const snap = this.snapshot(mid);
    const shortest = this.measureRoute(p.edges, p.nodes, snap);
    const shady = this.route(src, dst, snap, alpha)!;
    return { snap, shortest, shady };
  }

  /** The plain shortest path, by length only. */
  shortestByLength(src: number, dst: number) {
    const g = this.area.graph;
    return shortestPath(g, src, dst, (e) => g.edgeLen[e]);
  }

  /** Sun exposure for one departure time (used to build the "when to leave" chart step by step). */
  departure(src: number, dst: number, t: Date, alpha: number, p: { edges: number[]; nodes: number[] } | null) {
    const r = this.compare(src, dst, t, alpha, p);
    return r
      ? { time: t, shortestSunMin: r.shortest.sunMinutes, shadySunMin: r.shady.sunMinutes, shadyMin: r.shady.minutes, shortestMin: r.shortest.minutes, night: r.snap.field.night }
      : null;
  }

  /** Sun exposure for a range of departure times. */
  departures(src: number, dst: number, times: Date[], alpha: number) {
    const p = this.shortestByLength(src, dst);
    return times.map((t) => this.departure(src, dst, t, alpha, p));
  }
}
