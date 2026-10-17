// Fails the build if a bundled area file is not real OpenStreetMap data (it must carry the Overpass copyright notice).
import { readdirSync, readFileSync } from 'node:fs';
let bad = 0;
for (const f of readdirSync('public/areas')) {
  if (!f.endsWith('.json')) continue;
  const j = JSON.parse(readFileSync(`public/areas/${f}`, 'utf8'));
  if (!j.osm3s || !/openstreetmap/i.test(j.osm3s.copyright ?? '')) { console.error(`${f}: missing OSM copyright notice — not real Overpass data?`); bad++; }
  else console.log(`${f}: ok (${j.elements.length} elements, data timestamp ${j.osm3s.timestamp_osm_base})`);
}
process.exit(bad ? 1 : 0);
