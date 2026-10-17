/// <reference lib="webworker" />
import { parseOverpass, type OverpassJson } from './data/osm';
import { Planner } from './engine/planner';
import type { Area } from './engine/types';
import type { Projection } from './engine/project';
import type { FromWorker, ToWorker, RouteOut } from './protocol';

let area: Area | null = null;
let proj: Projection | null = null;
let planner: Planner | null = null;

const post = (m: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

function ringToLL(r: Float64Array): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < r.length; i += 2) out.push(proj!.toLL(r[i], r[i + 1]));
  out.push(out[0]);
  return out;
}

function staticLayers() {
  const a = area!, g = a.graph;
  const buildings = {
    type: 'FeatureCollection' as const,
    features: a.buildings.map((b, i) => ({
      type: 'Feature' as const,
      id: i,
      properties: { h: Math.round(b.height * 10) / 10, src: b.heightSource, kind: b.kind },
      geometry: { type: 'Polygon' as const, coordinates: [ringToLL(b.ring)] },
    })),
  };
  const streets = new Float32Array(g.edgeLen.length * 4);
  for (let e = 0; e < g.edgeLen.length; e++) {
    const [x1, y1] = proj!.toLL(g.nodeX[g.edgeA[e]], g.nodeY[g.edgeA[e]]);
    const [x2, y2] = proj!.toLL(g.nodeX[g.edgeB[e]], g.nodeY[g.edgeB[e]]);
    streets.set([x1, y1, x2, y2], e * 4);
  }
  const trees = new Float32Array(a.trees.length * 3);
  a.trees.forEach((t, i) => {
    const [lng, lat] = proj!.toLL(t.x, t.y);
    trees.set([lng, lat, t.r], i * 3);
  });
  return { buildings, streets, trees };
}

function shadowGeoJSON(snap: ReturnType<Planner['snapshot']>) {
  const feats: GeoJSON.Feature[] = [];
  if (snap.field.night) return { type: 'FeatureCollection' as const, features: feats };
  const a = area!;
  for (let i = 0; i < a.buildings.length; i++) {
    const r = snap.field.buildingShadowRing(i);
    if (r) feats.push({ type: 'Feature', properties: { k: 'b' }, geometry: { type: 'Polygon', coordinates: [ringToLL(r)] } });
  }
  for (let i = 0; i < a.trees.length; i++) {
    const c = snap.field.treeShadow(i);
    if (!c) continue;
    // capsule polygon: two half circles joined
    const ang = Math.atan2(c.y2 - c.y1, c.x2 - c.x1);
    const pts: number[] = [];
    for (let k = 0; k <= 8; k++) {
      const t = ang + Math.PI / 2 + (Math.PI * k) / 8;
      pts.push(c.x1 + c.r * Math.cos(t), c.y1 + c.r * Math.sin(t));
    }
    for (let k = 0; k <= 8; k++) {
      const t = ang - Math.PI / 2 + (Math.PI * k) / 8;
      pts.push(c.x2 + c.r * Math.cos(t), c.y2 + c.r * Math.sin(t));
    }
    feats.push({ type: 'Feature', properties: { k: 't' }, geometry: { type: 'Polygon', coordinates: [ringToLL(Float64Array.from(pts))] } });
  }
  return { type: 'FeatureCollection' as const, features: feats };
}

function routeOut(r: NonNullable<ReturnType<Planner['route']>>, snapSun: Float32Array): RouteOut {
  const g = area!.graph;
  const coords = r.nodes.map((n) => proj!.toLL(g.nodeX[n], g.nodeY[n]));
  const segSun = r.edges.map((e) => snapSun[e]);
  return { coords, segSun, lengthM: r.lengthM, minutes: r.minutes, sunMinutes: r.sunMinutes, sunM: r.sunM, treeM: r.treeM, shadePct: r.shadePct };
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  try {
    if (m.type === 'load') {
      const t0 = performance.now();
      const parsed = parseOverpass(m.json as OverpassJson, { id: m.id, name: m.name, bounds: m.bounds });
      area = parsed.area;
      proj = parsed.proj;
      planner = new Planner(area, proj);
      const layers = staticLayers();
      post({ type: 'loaded', id: m.id, stats: area.stats, center: area.center, bounds: area.bounds, ...layers, ms: performance.now() - t0 }, [layers.streets.buffer, layers.trees.buffer]);
      return;
    }
    if (!planner || !area || !proj) throw new Error('No area loaded');
    if (m.type === 'compute') {
      const t0 = performance.now();
      const depart = new Date(m.departISO);
      const src = m.from ? planner.nearestNode(m.from[0], m.from[1]) : -1;
      const dst = m.to ? planner.nearestNode(m.to[0], m.to[1]) : -1;
      let shortest: RouteOut | null = null, shady: RouteOut | null = null;
      let snap = planner.snapshot(depart);
      if (src >= 0 && dst >= 0 && src !== dst) {
        const r = planner.compare(src, dst, depart, m.alpha);
        if (r) {
          snap = r.snap;
          shortest = routeOut(r.shortest, r.snap.sun);
          shady = routeOut(r.shady, r.snap.sun);
        }
      }
      const shadows = shadowGeoJSON(snap);
      const sun = snap.sun.slice();
      post({
        type: 'computed', seq: m.seq,
        sunAlt: snap.field.sun.altitude, sunAz: snap.field.sun.azimuth, night: snap.field.night,
        evalISO: snap.time.toISOString(),
        shadows, edgeSun: sun, shortest, shady, ms: performance.now() - t0,
      }, [sun.buffer]);
      return;
    }
    if (m.type === 'plan') {
      const src = planner.nearestNode(m.from[0], m.from[1]);
      const dst = planner.nearestNode(m.to[0], m.to[1]);
      const rows = planner.departures(src, dst, m.timesISO.map((t) => new Date(t)), m.alpha)
        .map((r) => (r ? { ...r, time: r.time.toISOString() } : null));
      post({ type: 'planned', seq: m.seq, rows });
      return;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
