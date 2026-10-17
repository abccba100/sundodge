import { describe, expect, it } from 'vitest';
import { sunAt, shadowLength } from './sun';
import { ShadowField, convexHull } from './shadow';
import { buildGraph, shortestPath } from './graph';
import type { Building, Sun } from './types';
import { parseOverpass, buildingHeight, parseLength, type OverpassJson } from '../data/osm';
import { Planner } from './planner';

const square = (x0: number, y0: number, w: number, h: number): Float64Array =>
  Float64Array.from([x0, y0, x0 + w, y0, x0 + w, y0 + h, x0, y0 + h]);

const bld = (ring: Float64Array, height: number): Building => {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (let i = 0; i < ring.length; i += 2) { a = Math.min(a, ring[i]); b = Math.min(b, ring[i + 1]); c = Math.max(c, ring[i]); d = Math.max(d, ring[i + 1]); }
  return { id: 1, ring, height, heightSource: 'height', kind: 'yes', bbox: [a, b, c, d] };
};

/** Sun due south at 45 degrees: shadows point north, length = height. */
const southSun45: Sun = { altitude: Math.PI / 4, azimuth: Math.PI, dir: [0, -1] };

describe('sun position', () => {
  it('is in the south around solar noon in Seoul in June', () => {
    const s = sunAt(new Date('2026-06-21T03:30:00Z'), 37.57, 126.98); // 12:30 KST
    expect(s.dir[1]).toBeLessThan(-0.9);
    expect(s.altitude).toBeGreaterThan((70 * Math.PI) / 180);
  });
  it('is in the east in the morning and the west in the afternoon', () => {
    const am = sunAt(new Date('2026-06-21T23:00:00Z'), 37.57, 126.98); // 08:00 KST next day
    const pm = sunAt(new Date('2026-06-21T08:00:00Z'), 37.57, 126.98); // 17:00 KST
    expect(am.dir[0]).toBeGreaterThan(0.5);
    expect(pm.dir[0]).toBeLessThan(-0.5);
  });
  it('gives shadow length h / tan(altitude)', () => {
    expect(shadowLength(20, Math.PI / 4)).toBeCloseTo(20, 6);
    expect(shadowLength(10, Math.atan(0.5))).toBeCloseTo(20, 6);
  });
});

describe('building shadows', () => {
  const b = bld(square(0, 0, 10, 10), 20);
  const f = new ShadowField([b], [], southSun45);
  it('shades ground north of the building within its shadow length', () => {
    expect(f.shadeAt(5, 15)).toBe(1);
    expect(f.shadeAt(5, 29)).toBe(1);
  });
  it('leaves ground beyond the shadow, beside it, or south of it in sun', () => {
    expect(f.shadeAt(5, 31)).toBe(0);
    expect(f.shadeAt(-3, 15)).toBe(0);
    expect(f.shadeAt(5, -5)).toBe(0);
  });
  it('handles a concave L-shaped footprint exactly', () => {
    // L shape: notch at the north-east corner.
    const ring = Float64Array.from([0, 0, 20, 0, 20, 10, 10, 10, 10, 20, 0, 20]);
    const lf = new ShadowField([bld(ring, 5)], [], southSun45);
    expect(lf.shadeAt(15, 12)).toBe(1); // just north of the low wing
    expect(lf.shadeAt(15, 16)).toBe(0); // inside the notch, beyond the 5 m shadow
  });
  it('treats everything as shade when the sun is down', () => {
    const night = new ShadowField([b], [], { altitude: -0.2, azimuth: 0, dir: [0, 1] });
    expect(night.night).toBe(true);
    expect(night.shadeAt(1000, 1000)).toBe(1);
  });
  it('draws a hull that contains the footprint and the shifted copy', () => {
    const hull = convexHull([[0, 0], [10, 0], [10, 10], [0, 10], [0, 20], [10, 20], [10, 30], [0, 30]]);
    expect(hull.length).toBe(4);
  });
});

describe('tree shadows', () => {
  it('shades the ground where the ray to the sun passes the canopy', () => {
    const f = new ShadowField([], [{ x: 0, y: 0, r: 3, top: 8, base: 2 }], southSun45);
    // At 45 degrees the canopy band (2 m..8 m high) is crossed 2..8 m from the point.
    expect(f.shadeAt(0, 5)).toBe(2);
    expect(f.shadeAt(0, -5)).toBe(0);
    expect(f.shadeAt(6, 5)).toBe(0);
  });
});

describe('routing', () => {
  // Two parallel streets from A (0,0) to B (100,0): the straight one (y = 0) and a
  // detour (y = 20) that is 40 m longer but runs north of a long building.
  const ways = [
    { kind: 'footway', coords: [0, 0, 100, 0], ids: [1, 2] },
    { kind: 'footway', coords: [0, 0, 0, 20, 100, 20, 100, 0], ids: [1, 3, 4, 2] },
  ];
  const g = buildGraph(ways);
  it('finds the shortest path with unit costs', () => {
    const p = shortestPath(g, 0, 1, (e) => g.edgeLen[e])!;
    expect(p.cost).toBeCloseTo(100, 6);
  });
  it('prefers the shaded detour when sun costs more', () => {
    const sun = new Float32Array(g.edgeLen.length);
    sun[0] = 1; // straight street fully sunny
    const shady = shortestPath(g, 0, 1, (e) => g.edgeLen[e] * (1 - sun[e]) + 3 * g.edgeLen[e] * sun[e])!;
    expect(shady.edges.length).toBe(3);
  });
});

describe('OSM parsing', () => {
  it('reads heights from height, levels and type defaults', () => {
    expect(buildingHeight({ building: 'yes', height: '24 m' })).toEqual({ h: 24, src: 'height' });
    expect(buildingHeight({ building: 'apartments', 'building:levels': '15' })).toEqual({ h: 45, src: 'levels' });
    expect(buildingHeight({ building: 'house' }).src).toBe('estimate');
    expect(parseLength("30'")).toBeCloseTo(9.144, 3);
  });
  it('builds an area that routes around a shading building', () => {
    const lat0 = 37.57, lng0 = 126.98;
    const dLat = (m: number) => m / 110574;
    const dLng = (m: number) => m / (Math.cos((lat0 * Math.PI) / 180) * 111320);
    const P = (x: number, y: number) => ({ lat: lat0 + dLat(y), lon: lng0 + dLng(x) });
    const json = {
      elements: [
        // street along y = 0 and y = 30, linked at both ends
        { type: 'way' as const, id: 10, tags: { highway: 'footway' }, nodes: [1, 2], geometry: [P(-50, 0), P(50, 0)] },
        { type: 'way' as const, id: 11, tags: { highway: 'footway' }, nodes: [1, 3, 4, 2], geometry: [P(-50, 0), P(-50, 30), P(50, 30), P(50, 0)] },
        // tall building just south of the y = 30 street
        { type: 'way' as const, id: 20, tags: { building: 'yes', height: '40' }, nodes: [5, 6, 7, 8, 5], geometry: [P(-45, 10), P(45, 10), P(45, 25), P(-45, 25), P(-45, 10)] },
      ],
    };
    const { area, proj } = parseOverpass(json as unknown as OverpassJson, { id: 't', name: 't', bounds: [lng0 - dLng(100), lat0 - dLat(100), lng0 + dLng(100), lat0 + dLat(100)] });
    expect(area.buildings.length).toBe(1);
    expect(area.stats.buildingsWithHeight).toBe(1);
    const planner = new Planner(area, proj);
    const [x1, y1] = proj.toXY(lng0 - dLng(50), lat0);
    const [x2, y2] = proj.toXY(lng0 + dLng(50), lat0);
    const src = planner.locator.nearest(x1, y1);
    const dst = planner.locator.nearest(x2, y2);
    const noon = new Date('2026-06-21T03:30:00Z'); // sun high in the south
    const r = planner.compare(src, dst, noon, 3)!;
    expect(r.shortest.lengthM).toBeCloseTo(100, 0);
    expect(r.shortest.shadePct).toBeLessThan(5);
    expect(r.shady.lengthM).toBeGreaterThan(150);
    expect(r.shady.sunM).toBeLessThan(r.shortest.sunM);
  });
});
