// Data check for bundled areas: lists buildings that sit on top of open (not covered) walkways.
// A footprint over a street usually means a mapping quirk the parser should know about
// (an underground station, a bridge, a roof on pillars). Informational: exits 0.
// Usage: npx tsx scripts/lint-areas.ts [minSamples=20]
import { readFileSync, readdirSync } from 'node:fs';
import Flatbush from 'flatbush';
import { parseOverpass } from '../src/data/osm';
import { EdgeSampler } from '../src/engine/planner';
import { pointInRing } from '../src/engine/shadow';
import { DEMO_AREAS } from '../src/areas';

const min = Number(process.argv[2] ?? 20);
for (const f of readdirSync('public/areas').filter((x) => x.endsWith('.json'))) {
  const id = f.replace(/\.json$/, '');
  const demo = DEMO_AREAS.find((a) => a.id === id);
  if (!demo) continue;
  const { area } = parseOverpass(JSON.parse(readFileSync(`public/areas/${f}`, 'utf8')), { id, name: demo.name, bounds: demo.bounds });
  const g = area.graph;
  const s = new EdgeSampler(g);
  const idx = new Flatbush(area.buildings.length);
  for (const b of area.buildings) idx.add(...b.bbox);
  idx.finish();
  const count = new Map<number, number>();
  let inside = 0, total = 0;
  for (let e = 0; e < g.edgeLen.length; e++) {
    if (g.edgeCovered[e]) continue;
    for (let k = s.start[e]; k < s.start[e + 1]; k++) {
      total++;
      const x = s.sx[k], y = s.sy[k];
      const hit = idx.search(x, y, x, y).find((i) => area.buildings[i].minHeight === 0 && pointInRing(x, y, area.buildings[i].ring));
      if (hit !== undefined) { inside++; count.set(hit, (count.get(hit) ?? 0) + 1); }
    }
  }
  const top = [...count.entries()].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1]);
  console.log(`${f}: ${inside} of ${total} open-street samples (${((inside / total) * 100).toFixed(1)}%) fall inside a building footprint; ${top.length} buildings with >= ${min}:`);
  for (const [i, n] of top.slice(0, 15)) {
    const b = area.buildings[i];
    console.log(`  osm ${b.id} kind=${b.kind} h=${b.height.toFixed(0)} m (${b.heightSource}) samples=${n}`);
  }
}
