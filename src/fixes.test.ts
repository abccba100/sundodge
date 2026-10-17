import { describe, expect, it } from 'vitest';
import { parseOverpass, parseLength, buildingHeight, type OverpassJson } from './data/osm';
import { ShadowField } from './engine/shadow';
import { Planner } from './engine/planner';
import { sunWindow } from './sunwindow';
import type { Building, Sun } from './engine/types';

// Small helpers to build synthetic OSM data around a point, in metres.
const lat0 = 37.57, lng0 = 126.98;
const dLat = (m: number) => m / 110574;
const dLng = (m: number) => m / (Math.cos((lat0 * Math.PI) / 180) * 111320);
const P = (x: number, y: number) => ({ lat: lat0 + dLat(y), lon: lng0 + dLng(x) });
const bounds: [number, number, number, number] = [lng0 - dLng(200), lat0 - dLat(200), lng0 + dLng(200), lat0 + dLat(200)];
const parse = (elements: unknown[]) => parseOverpass({ elements } as unknown as OverpassJson, { id: 't', name: 't', bounds });
const rect = (x0: number, y0: number, x1: number, y1: number) => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1), P(x0, y0)];

describe('underground features', () => {
  it('does not extrude underground buildings (e.g. subway stations)', () => {
    const { area } = parse([
      { type: 'way', id: 1, tags: { building: 'train_station', layer: '-1' }, nodes: [1, 2, 3, 4, 1], geometry: rect(0, 0, 50, 50) },
      { type: 'way', id: 2, tags: { building: 'train_station', location: 'underground' }, nodes: [5, 6, 7, 8, 5], geometry: rect(60, 0, 90, 50) },
      { type: 'way', id: 3, tags: { building: 'yes' }, nodes: [9, 10, 11, 12, 9], geometry: rect(100, 0, 120, 20) },
    ]);
    expect(area.buildings.map((b) => b.id)).toEqual([3]);
  });

  it('keeps pedestrian tunnels as covered, drops road tunnels, keeps roads under a building', () => {
    const { area } = parse([
      // 0: car tunnel, no pedestrians -> dropped
      { type: 'way', id: 10, tags: { highway: 'primary', tunnel: 'yes' }, nodes: [1, 2], geometry: [P(-100, 0), P(100, 0)] },
      // 1: underground footway (layer -1, no tunnel tag) -> covered
      { type: 'way', id: 11, tags: { highway: 'footway', layer: '-1' }, nodes: [3, 4], geometry: [P(-100, 50), P(100, 50)] },
      // 2: road "tunnel" running beneath a building at street level -> kept, covered
      { type: 'way', id: 12, tags: { highway: 'primary', tunnel: 'yes' }, nodes: [5, 6], geometry: [P(-40, 100), P(40, 100)] },
      { type: 'way', id: 13, tags: { building: 'commercial', 'building:levels': '4' }, nodes: [7, 8, 9, 10, 7], geometry: rect(-50, 90, 50, 110) },
      // 3: road tunnel with foot=yes -> kept, covered
      { type: 'way', id: 14, tags: { highway: 'secondary', tunnel: 'yes', foot: 'yes' }, nodes: [11, 12], geometry: [P(-100, 150), P(100, 150)] },
      // 4: ordinary street -> kept, open
      { type: 'way', id: 15, tags: { highway: 'residential' }, nodes: [13, 14], geometry: [P(-100, -50), P(100, -50)] },
    ]);
    const g = area.graph;
    const edges = Array.from(g.edgeLen.keys()).map((e) => ({ y: Math.round((g.nodeY[g.edgeA[e]] + g.nodeY[g.edgeB[e]]) / 2), covered: g.edgeCovered[e] }));
    const atY = (y: number) => edges.filter((e) => Math.abs(e.y - y) < 3);
    expect(atY(0)).toHaveLength(0);
    expect(atY(50).every((e) => e.covered === 1)).toBe(true);
    expect(atY(100).length).toBeGreaterThan(0);
    expect(atY(100).every((e) => e.covered === 1)).toBe(true);
    expect(atY(150).every((e) => e.covered === 1)).toBe(true);
    expect(atY(-50).every((e) => e.covered === 0)).toBe(true);
  });
});

describe('overhangs (min_height)', () => {
  // 10 x 10 m block from 4 m to 10 m above ground; sun due south.
  const ring = Float64Array.from([0, 0, 10, 0, 10, 10, 0, 10]);
  const b: Building = { id: 1, ring, height: 10, minHeight: 4, heightSource: 'height', kind: 'roof', bbox: [0, 0, 10, 10] };
  const sun = (deg: number): Sun => ({ altitude: (deg * Math.PI) / 180, azimuth: Math.PI, dir: [0, -1] });

  it('lets a high sun shine under the overhang onto ground north of it', () => {
    // At 80 deg the block only blocks rays between 0.7 m and 1.8 m from the point.
    const f = new ShadowField([b], [], sun(80));
    expect(f.shadeAt(5, 13)).toBe(0); // 3 m north of the block: ray passes under it
    expect(f.shadeAt(5, 9)).toBe(1); // under the block, 1 m from its north edge
  });

  it('shades ground north of it when the sun is lower', () => {
    const f = new ShadowField([b], [], sun(45)); // blocks rays between 4 m and 10 m
    expect(f.shadeAt(5, 15)).toBe(1);
    expect(f.shadeAt(5, 21)).toBe(0);
  });

  it('reads min_height and building:min_level', () => {
    expect(buildingHeight({ building: 'roof', min_height: '4', height: '6' })).toEqual({ h: 6, src: 'height', min: 4 });
    expect(buildingHeight({ building: 'yes', 'building:min_level': '2', 'building:levels': '3' })).toEqual({ h: 15, src: 'levels', min: 6 });
  });
});

describe('parseLength', () => {
  it('reads metres, feet and feet+inches, and rejects implausible values', () => {
    expect(parseLength('12')).toBe(12);
    expect(parseLength('12.5 m')).toBe(12.5);
    expect(parseLength('12,5')).toBe(12.5);
    expect(parseLength("40'")).toBeCloseTo(12.192, 3);
    expect(parseLength('13\'6"')).toBeCloseTo(4.115, 3);
    expect(parseLength('5000 ft')).toBeNull();
    expect(parseLength('1,234')).toBeNull();
    expect(parseLength('0')).toBeNull();
    expect(parseLength('tall')).toBeNull();
  });
});

describe('sun window', () => {
  it('is an ordinary day in Seoul', () => {
    const w = sunWindow('2026-08-05', 'Asia/Seoul', 37.57, 126.98);
    expect(w.kind).toBe('normal');
    expect(w.rise).toBeGreaterThan(5 * 60);
    expect(w.set).toBeLessThan(20 * 60);
    expect(w.min).toBeLessThan(w.max);
  });
  it('handles midnight sun and polar night without throwing', () => {
    expect(sunWindow('2026-06-21', 'Arctic/Longyearbyen', 78.22, 15.65).kind).toBe('polar-day');
    expect(sunWindow('2026-12-21', 'Arctic/Longyearbyen', 78.22, 15.65).kind).toBe('polar-night');
    const w = sunWindow('2026-06-21', 'Arctic/Longyearbyen', 78.22, 15.65);
    expect([w.min, w.max]).toEqual([0, 1435]);
  });
  it('gives a full-day slider when sunset falls after local midnight', () => {
    const w = sunWindow('2026-06-21', 'Atlantic/Reykjavik', 64.14, -21.94);
    expect(w.kind).toBe('wrap');
    expect(w.min).toBe(0);
    expect(w.max).toBe(1435);
  });
});

describe('departure sweep', () => {
  it('matches a fresh comparison for each departure time', () => {
    const { area, proj } = parse([
      { type: 'way', id: 10, tags: { highway: 'footway' }, nodes: [1, 2], geometry: [P(-50, 0), P(50, 0)] },
      { type: 'way', id: 11, tags: { highway: 'footway' }, nodes: [1, 3, 4, 2], geometry: [P(-50, 0), P(-50, 30), P(50, 30), P(50, 0)] },
      { type: 'way', id: 20, tags: { building: 'yes', height: '40' }, nodes: [5, 6, 7, 8, 5], geometry: rect(-45, 10, 45, 25) },
    ]);
    const planner = new Planner(area, proj);
    const src = planner.nearestNode(lng0 - dLng(50), lat0);
    const dst = planner.nearestNode(lng0 + dLng(50), lat0);
    const times = [0, 60, 120].map((m) => new Date(Date.UTC(2026, 5, 21, 2, m)));
    const rows = planner.departures(src, dst, times, 3);
    rows.forEach((r, i) => {
      const c = planner.compare(src, dst, times[i], 3)!;
      expect(r!.shadySunMin).toBeCloseTo(c.shady.sunMinutes, 6);
      expect(r!.shortestSunMin).toBeCloseTo(c.shortest.sunMinutes, 6);
    });
  });
});
