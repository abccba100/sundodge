// Merge extra OSM tags (layer, location, min_height, building:min_level) into a bundled area file.
// The bundled files were trimmed before these keys were kept, so they were re-read with a tags-only
// Overpass query and stored in scripts/retag-2026-10-17.json. Geometry is not touched.
// Usage: node scripts/merge-tags.mjs <area-id>
import { readFileSync, writeFileSync } from 'node:fs';
const id = process.argv[2];
const extra = JSON.parse(readFileSync(new URL('./retag-2026-10-17.json', import.meta.url), 'utf8'));
const tags = extra[id];
if (!tags) { console.error(`no tags for ${id}`); process.exit(1); }
const path = `public/areas/${id}.json`;
const j = JSON.parse(readFileSync(path, 'utf8'));
let hit = 0;
for (const el of j.elements) {
  const t = tags[el.type[0] + el.id];
  if (!t) continue;
  el.tags = { ...(el.tags ?? {}), ...t };
  hit++;
}
j.retag = { date: '2026-10-17', keys: ['layer', 'location', 'min_height', 'building:min_level'], source: 'scripts/retag-2026-10-17.json', matched: hit, listed: Object.keys(tags).length };
writeFileSync(path, JSON.stringify(j));
console.log(`${path}: merged tags into ${hit} of ${Object.keys(tags).length} listed elements`);
