// Dev tool: evaluate candidate demo walks on a pre-cached area.
// Usage: npx tsx scripts/scenarios.ts <area.json> <tz> <YYYY-MM-DD> <HH:MM> <lng,lat;lng,lat> [more pairs...]
import { readFileSync } from 'node:fs';
import { parseOverpass } from '../src/data/osm';
import { Planner } from '../src/engine/planner';
import { zonedToDate, parseClock } from '../src/time';

const [file, tz, day, clock, ...pairs] = process.argv.slice(2);
const json = JSON.parse(readFileSync(file, 'utf8'));
let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
for (const el of json.elements) {
  const pts = el.geometry ?? (el.lat ? [{ lat: el.lat, lon: el.lon }] : []);
  for (const p of pts) if (p) { w = Math.min(w, p.lon); e = Math.max(e, p.lon); s = Math.min(s, p.lat); n = Math.max(n, p.lat); }
}
const { area, proj } = parseOverpass(json, { id: 'x', name: 'x', bounds: [w, s, e, n] });
console.log('stats', area.stats);
const planner = new Planner(area, proj);
for (const pair of pairs) {
  const [a, b] = pair.split(';').map((p) => p.split(',').map(Number));
  const src = planner.nearestNode(a[0], a[1]);
  const dst = planner.nearestNode(b[0], b[1]);
  const t0 = parseClock(clock);
  const rows: string[] = [];
  for (let m = t0 - 60; m <= t0 + 60; m += 30) {
    const r = planner.compare(src, dst, zonedToDate(day, m, tz), 3);
    if (!r) { rows.push('no route'); continue; }
    rows.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')} short ${r.shortest.minutes.toFixed(1)}m sun ${r.shortest.sunMinutes.toFixed(1)} | shady ${r.shady.minutes.toFixed(1)}m sun ${r.shady.sunMinutes.toFixed(1)}`);
  }
  const snapA = proj.toLL(area.graph.nodeX[src], area.graph.nodeY[src]);
  const snapB = proj.toLL(area.graph.nodeX[dst], area.graph.nodeY[dst]);
  console.log(`\n${pair}  snapped A ${snapA.map((v) => v.toFixed(5))} (${area.graph.edgeKind[area.graph.adjEdge[area.graph.adjStart[src]]]}) B ${snapB.map((v) => v.toFixed(5))}`);
  console.log(rows.join('\n'));
}
