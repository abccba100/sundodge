import type { Area, Building, HeightSource, LngLat, Tree } from '../engine/types';
import { makeProjection, type Projection } from '../engine/project';
import Flatbush from 'flatbush';
import { buildGraph, type WayInput } from '../engine/graph';
import { pointInRing } from '../engine/shadow';

/** Overpass QL used both by the in-app loader and by scripts/fetch-area.mjs. */
export function overpassQuery(bounds: [number, number, number, number]): string {
  const [w, s, e, n] = bounds;
  const bb = `${s},${w},${n},${e}`;
  return `[out:json][timeout:90];
(
  way["building"](${bb});
  relation["building"]["type"="multipolygon"](${bb});
  way["highway"](${bb});
  node["natural"="tree"](${bb});
  way["natural"="tree_row"](${bb});
  way["leisure"="park"](${bb});
  way["landuse"="grass"](${bb});
  way["natural"="water"](${bb});
);
out geom;`;
}

interface OsmGeomPoint { lat: number; lon: number }
interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  nodes?: number[];
  geometry?: (OsmGeomPoint | null)[];
  members?: { type: string; role: string; ref: number; geometry?: (OsmGeomPoint | null)[] }[];
}
export interface OverpassJson { elements: OsmElement[] }

/** Floor-to-floor height used to turn building:levels into metres (OSM wiki: "3 m per floor is probably a good approximation"). */
export const METRES_PER_LEVEL = 3;

/** Fallback heights when OSM has neither height nor building:levels. Shown to the user as "estimated". */
const DEFAULT_HEIGHT: Record<string, number> = {
  house: 7, detached: 7, semidetached_house: 7, terrace: 8, bungalow: 4, hut: 3, cabin: 3,
  garage: 3, garages: 3, shed: 3, kiosk: 3, roof: 4, carport: 3, toilets: 3, service: 4,
  apartments: 15, residential: 12, dormitory: 15, hotel: 20,
  commercial: 12, office: 15, retail: 8, supermarket: 8, mall: 15,
  school: 12, university: 15, college: 15, kindergarten: 6, hospital: 18,
  church: 12, temple: 8, public: 12, civic: 12, government: 15,
  industrial: 8, warehouse: 8, train_station: 12, parking: 10,
};
const DEFAULT_OTHER = 9;

const WALKABLE = new Set([
  'footway', 'path', 'pedestrian', 'living_street', 'residential', 'service', 'unclassified',
  'tertiary', 'tertiary_link', 'secondary', 'secondary_link', 'primary', 'primary_link',
  'steps', 'track', 'cycleway', 'corridor', 'crossing',
]);

/** Roads meant for cars. A tunnel on one of these is a road tunnel unless pedestrians are explicitly allowed. */
const MOTOR = new Set([
  'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
  'residential', 'unclassified', 'service', 'track',
]);
const FOOT_OK = new Set(['yes', 'designated', 'permissive']);
const SIDEWALK_OK = new Set(['yes', 'both', 'left', 'right']);

/**
 * Parses an OSM length in metres ("12", "12 m", "12.5", "40'", "13'6\"", "40 ft").
 * Returns null for anything implausible (≤ 0 or ≥ 1000 m) or ambiguous ("1,234").
 */
export function parseLength(v: string | undefined): number | null {
  if (!v) return null;
  const s = v.trim();
  if (/^\d{1,3},\d{3}/.test(s)) return null; // thousands separator: ambiguous, skip
  let x: number;
  const ftIn = /^(\d+(?:[.,]\d+)?)\s*(?:'|ft|feet)\s*(?:(\d+(?:[.,]\d+)?)\s*(?:"|in|inch(?:es)?))?/i.exec(s);
  if (ftIn) {
    x = parseFloat(ftIn[1].replace(',', '.')) * 0.3048 + (ftIn[2] ? parseFloat(ftIn[2].replace(',', '.')) * 0.0254 : 0);
  } else {
    const m = /^(\d+(?:[.,]\d+)?)/.exec(s);
    if (!m) return null;
    x = parseFloat(m[1].replace(',', '.'));
  }
  return Number.isFinite(x) && x > 0 && x < 1000 ? x : null;
}

/** Underground or indoor-below-ground features (layer < 0 or location=underground). */
export function isUnderground(tags: Record<string, string>): boolean {
  const layer = parseFloat(tags.layer ?? '0');
  return (Number.isFinite(layer) && layer < 0) || tags.location === 'underground';
}

export function buildingHeight(tags: Record<string, string>): { h: number; src: HeightSource; min: number } {
  const minLv = parseLength(tags['building:min_level']);
  const min = parseLength(tags.min_height) ?? (minLv ? minLv * METRES_PER_LEVEL : 0);
  const h = parseLength(tags.height);
  if (h && h > min) return { h, src: 'height', min };
  const lv = parseLength(tags['building:levels']);
  if (lv) {
    const roof = parseLength(tags['roof:levels']) ?? 0;
    // building:levels counts the levels of this part, starting at its underside.
    return { h: min + (lv + roof) * METRES_PER_LEVEL, src: 'levels', min };
  }
  const kind = tags.building ?? 'yes';
  const est = DEFAULT_HEIGHT[kind] ?? DEFAULT_OTHER;
  return { h: Math.max(est, min + METRES_PER_LEVEL), src: 'estimate', min };
}

function ringFromGeom(geom: (OsmGeomPoint | null)[] | undefined, proj: Projection): Float64Array | null {
  if (!geom) return null;
  const pts = geom.filter((p): p is OsmGeomPoint => !!p);
  if (pts.length < 4) return null;
  const first = pts[0], last = pts[pts.length - 1];
  const closed = first.lat === last.lat && first.lon === last.lon;
  const use = closed ? pts.slice(0, -1) : pts;
  if (use.length < 3) return null;
  const out = new Float64Array(use.length * 2);
  use.forEach((p, i) => {
    const [x, y] = proj.toXY(p.lon, p.lat);
    out[2 * i] = x;
    out[2 * i + 1] = y;
  });
  return out;
}

function bboxOf(r: Float64Array): [number, number, number, number] {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    a = Math.min(a, r[i]); b = Math.min(b, r[i + 1]);
    c = Math.max(c, r[i]); d = Math.max(d, r[i + 1]);
  }
  return [a, b, c, d];
}

/** Join open member ways of a multipolygon relation into closed outer rings. */
function outerRings(members: NonNullable<OsmElement['members']>): (OsmGeomPoint | null)[][] {
  const parts = members.filter((m) => m.role === 'outer' && m.geometry && m.geometry.length > 1)
    .map((m) => m.geometry!.filter((p): p is OsmGeomPoint => !!p));
  const rings: OsmGeomPoint[][] = [];
  const same = (a: OsmGeomPoint, b: OsmGeomPoint) => a.lat === b.lat && a.lon === b.lon;
  while (parts.length) {
    let ring = parts.shift()!;
    let grew = true;
    while (!same(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const end = ring[ring.length - 1];
        if (same(end, p[0])) { ring = ring.concat(p.slice(1)); }
        else if (same(end, p[p.length - 1])) { ring = ring.concat(p.slice(0, -1).reverse()); }
        else continue;
        parts.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (same(ring[0], ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}

export interface ParseOptions {
  id: string;
  name: string;
  bounds: [number, number, number, number];
}

export function parseOverpass(json: OverpassJson, opt: ParseOptions): { area: Area; proj: Projection } {
  const [w, s, e, n] = opt.bounds;
  const center: LngLat = [(w + e) / 2, (s + n) / 2];
  const proj = makeProjection(center[0], center[1]);
  const buildings: Building[] = [];
  const trees: Tree[] = [];
  const ways: WayInput[] = [];
  const decor: Area['decor'] = [];
  let withH = 0, withL = 0;

  const addBuilding = (id: number, tags: Record<string, string>, geom: (OsmGeomPoint | null)[]) => {
    // Underground stations, car parks and passages are mapped as buildings too; they cast no shadow.
    if (isUnderground(tags)) return;
    const ring = ringFromGeom(geom, proj);
    if (!ring) return;
    const { h, src, min } = buildingHeight(tags);
    if (src === 'height') withH++;
    if (src === 'levels') withL++;
    buildings.push({ id, ring, height: h, minHeight: min, heightSource: src, kind: tags.building ?? 'yes', bbox: bboxOf(ring) });
  };
  // Road tunnels are only walkable if pedestrians are allowed or the "tunnel" is a road running under a building.
  const tunnelCandidates: { way: WayInput; pts: [number, number][] }[] = [];

  for (const el of json.elements) {
    const tags = el.tags ?? {};
    if (el.type === 'node' && tags.natural === 'tree' && el.lat !== undefined && el.lon !== undefined) {
      const [x, y] = proj.toXY(el.lon, el.lat);
      const crown = parseLength(tags.diameter_crown);
      const top = parseLength(tags.height) ?? 8;
      trees.push({ x, y, r: crown ? crown / 2 : 3, top, base: Math.min(Math.max(2, top * 0.3), top * 0.5) });
      continue;
    }
    if (el.type === 'way' && tags.building && el.geometry) {
      addBuilding(el.id, tags, el.geometry);
      continue;
    }
    if (el.type === 'relation' && tags.building && el.members) {
      for (const r of outerRings(el.members)) addBuilding(el.id, tags, r);
      continue;
    }
    if (el.type === 'way' && tags.highway && el.geometry && el.nodes) {
      const hw = tags.highway;
      if (!WALKABLE.has(hw)) continue;
      if (tags.foot === 'no' || ((tags.access === 'private' || tags.access === 'no') && tags.foot !== 'yes' && tags.foot !== 'designated')) continue;
      if (hw === 'cycleway' && !(tags.foot === 'yes' || tags.foot === 'designated')) continue;
      const coords: number[] = [];
      const ids: number[] = [];
      el.geometry.forEach((p, i) => {
        if (!p) return;
        const [x, y] = proj.toXY(p.lon, p.lat);
        coords.push(x, y);
        ids.push(el.nodes![i]);
      });
      const underground = isUnderground(tags);
      const covered = underground || tags.tunnel === 'yes' || tags.tunnel === 'building_passage' || tags.covered === 'yes' || tags.indoor === 'yes' || hw === 'corridor';
      const way: WayInput = { kind: hw, coords, ids, covered };
      const roadTunnel = MOTOR.has(hw) && (tags.tunnel === 'yes' || (underground && tags.tunnel !== 'building_passage'));
      if (roadTunnel && !FOOT_OK.has(tags.foot ?? '') && !SIDEWALK_OK.has(tags.sidewalk ?? '')) {
        const pts: [number, number][] = [];
        for (let k = 0; k < coords.length; k += 2) pts.push([coords[k], coords[k + 1]]);
        tunnelCandidates.push({ way, pts });
        continue;
      }
      ways.push(way);
      continue;
    }
    if (el.type === 'way' && tags.natural === 'tree_row' && el.geometry) {
      const pts = el.geometry.filter((p): p is OsmGeomPoint => !!p).map((p) => proj.toXY(p.lon, p.lat));
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        const len = Math.hypot(x1 - x0, y1 - y0);
        const k = Math.max(1, Math.round(len / 8));
        for (let j = 0; j < k; j++) {
          const t = (j + 0.5) / k;
          trees.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, r: 3, top: 8, base: 2.5 });
        }
      }
      continue;
    }
    if (el.type === 'way' && el.geometry && (tags.leisure === 'park' || tags.landuse === 'grass' || tags.natural === 'water')) {
      const ring = el.geometry.filter((p): p is OsmGeomPoint => !!p).map((p) => [p.lon, p.lat] as LngLat);
      if (ring.length >= 4) decor.push({ kind: tags.natural === 'water' ? 'water' : 'park', rings: [ring] });
    }
  }

  // A road "tunnel" that runs under a mapped building (e.g. a street passing beneath an arcade
  // building) is usually walkable at street level; a real road tunnel is not.
  if (tunnelCandidates.length) {
    const idx = buildings.length ? new Flatbush(buildings.length) : null;
    if (idx) { for (const b of buildings) idx.add(b.bbox[0], b.bbox[1], b.bbox[2], b.bbox[3]); idx.finish(); }
    for (const c of tunnelCandidates) {
      let total = 0, under = 0;
      for (let k = 1; k < c.pts.length; k++) {
        const [x0, y0] = c.pts[k - 1], [x1, y1] = c.pts[k];
        const len = Math.hypot(x1 - x0, y1 - y0);
        const n = Math.max(1, Math.ceil(len / 5));
        for (let j = 0; j < n; j++) {
          const x = x0 + ((j + 0.5) / n) * (x1 - x0), y = y0 + ((j + 0.5) / n) * (y1 - y0);
          total += len / n;
          if (idx && idx.search(x, y, x, y).some((i) => pointInRing(x, y, buildings[i].ring))) under += len / n;
        }
      }
      if (total > 0 && under / total >= 0.5) ways.push(c.way);
    }
  }

  const graph = buildGraph(ways);
  let walk = 0;
  for (let i = 0; i < graph.edgeLen.length; i++) walk += graph.edgeLen[i];
  const area: Area = {
    id: opt.id,
    name: opt.name,
    center,
    bounds: opt.bounds,
    buildings,
    trees,
    graph,
    decor,
    stats: {
      buildings: buildings.length,
      buildingsWithHeight: withH,
      buildingsWithLevels: withL,
      trees: trees.length,
      edges: graph.edgeLen.length,
      walkKm: walk / 1000,
    },
  };
  return { area, proj };
}
