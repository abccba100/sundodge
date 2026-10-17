import Flatbush from 'flatbush';
import type { Building, Sun, Tree } from './types';
import { MIN_SUN_ALTITUDE, shadowLength } from './sun';

/**
 * A ground point P is in a building's shadow exactly when the ray from P
 * toward the sun passes through the building. On flat ground, with a
 * prism of height h, that ray is below the roof for the first
 * L = h / tan(altitude) metres. So P is shaded iff the 2-D segment
 * P -> P + L * sunDir touches the footprint. No polygon unions needed.
 */

export function pointInRing(x: number, y: number, ring: Float64Array): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[2 * i], yi = ring[2 * i + 1];
    const xj = ring[2 * j], yj = ring[2 * j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

export function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  // Collinear touching cases are rare with real coordinates; treat as no hit.
  return false;
}

export function segmentHitsRing(ax: number, ay: number, bx: number, by: number, ring: Float64Array): boolean {
  if (pointInRing(ax, ay, ring) || pointInRing(bx, by, ring)) return true;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    if (segmentsIntersect(ax, ay, bx, by, ring[2 * j], ring[2 * j + 1], ring[2 * i], ring[2 * i + 1])) return true;
  }
  return false;
}

/** Distance from point C to segment AB. */
export function distPointSegment(cx: number, cy: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax, vy = by - ay;
  const wx = cx - ax, wy = cy - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? (wx * vx + wy * vy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = ax + t * vx - cx, py = ay + t * vy - cy;
  return Math.hypot(px, py);
}

/**
 * Shadow state of a whole area at one moment. Build once per time step,
 * then query thousands of points.
 */
export class ShadowField {
  readonly sun: Sun;
  readonly night: boolean;
  private buildings: Building[];
  private trees: Tree[];
  private bLen: Float64Array;
  private bIndex: Flatbush | null = null;
  private tIndex: Flatbush | null = null;

  constructor(buildings: Building[], trees: Tree[], sun: Sun) {
    this.sun = sun;
    this.buildings = buildings;
    this.trees = trees;
    this.night = sun.altitude <= MIN_SUN_ALTITUDE;
    this.bLen = new Float64Array(buildings.length);
    if (this.night) return;

    const [dx, dy] = sun.dir;
    if (buildings.length) {
      const idx = new Flatbush(buildings.length);
      for (let i = 0; i < buildings.length; i++) {
        const b = buildings[i];
        const L = shadowLength(b.height, sun.altitude);
        this.bLen[i] = L;
        // Shadow region = footprint swept away from the sun by L.
        const ox = -dx * L, oy = -dy * L;
        idx.add(
          Math.min(b.bbox[0], b.bbox[0] + ox), Math.min(b.bbox[1], b.bbox[1] + oy),
          Math.max(b.bbox[2], b.bbox[2] + ox), Math.max(b.bbox[3], b.bbox[3] + oy),
        );
      }
      idx.finish();
      this.bIndex = idx;
    }
    if (trees.length) {
      const idx = new Flatbush(trees.length);
      const t = Math.tan(sun.altitude);
      for (const tr of trees) {
        const sFar = Math.min(400, tr.top / t);
        const sNear = tr.base / t;
        const x1 = tr.x - dx * sNear, y1 = tr.y - dy * sNear;
        const x2 = tr.x - dx * sFar, y2 = tr.y - dy * sFar;
        idx.add(Math.min(x1, x2) - tr.r, Math.min(y1, y2) - tr.r, Math.max(x1, x2) + tr.r, Math.max(y1, y2) + tr.r);
      }
      idx.finish();
      this.tIndex = idx;
    }
  }

  /** Which kind of shade covers point (x, y): 0 = sun, 1 = building, 2 = tree. */
  shadeAt(x: number, y: number): 0 | 1 | 2 {
    if (this.night) return 1;
    const [dx, dy] = this.sun.dir;
    if (this.bIndex) {
      const hits = this.bIndex.search(x, y, x, y);
      for (const i of hits) {
        const L = this.bLen[i];
        if (segmentHitsRing(x, y, x + dx * L, y + dy * L, this.buildings[i].ring)) return 1;
      }
    }
    if (this.tIndex) {
      const t = Math.tan(this.sun.altitude);
      const hits = this.tIndex.search(x, y, x, y);
      for (const i of hits) {
        const tr = this.trees[i];
        const s1 = tr.base / t, s2 = Math.min(400, tr.top / t);
        if (distPointSegment(tr.x, tr.y, x + dx * s1, y + dy * s1, x + dx * s2, y + dy * s2) <= tr.r) return 2;
      }
    }
    return 0;
  }

  /** Shadow outline of building i for drawing: convex hull of footprint and its shifted copy. */
  buildingShadowRing(i: number): Float64Array | null {
    if (this.night) return null;
    const b = this.buildings[i];
    const L = this.bLen[i];
    const ox = -this.sun.dir[0] * L, oy = -this.sun.dir[1] * L;
    const n = b.ring.length / 2;
    const pts: [number, number][] = [];
    for (let k = 0; k < n; k++) {
      pts.push([b.ring[2 * k], b.ring[2 * k + 1]]);
      pts.push([b.ring[2 * k] + ox, b.ring[2 * k + 1] + oy]);
    }
    const hull = convexHull(pts);
    const out = new Float64Array(hull.length * 2);
    hull.forEach((p, k) => { out[2 * k] = p[0]; out[2 * k + 1] = p[1]; });
    return out;
  }

  /** Approximate canopy shadow for drawing: a capsule from near to far reach. */
  treeShadow(i: number): { x1: number; y1: number; x2: number; y2: number; r: number } | null {
    if (this.night) return null;
    const tr = this.trees[i];
    const t = Math.tan(this.sun.altitude);
    const [dx, dy] = this.sun.dir;
    const s1 = tr.base / t, s2 = Math.min(400, tr.top / t);
    return { x1: tr.x - dx * s1, y1: tr.y - dy * s1, x2: tr.x - dx * s2, y2: tr.y - dy * s2, r: tr.r };
  }
}

/** Andrew's monotone chain. */
export function convexHull(points: [number, number][]): [number, number][] {
  const pts = points.slice().sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  if (pts.length < 3) return pts;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
