#!/usr/bin/env node
// Fetch one area from the Overpass API and save a trimmed copy for ShadeWalk.
// Usage: node scripts/fetch-area.mjs <id> <west> <south> <east> <north>
// Please respect the Overpass usage policy: https://dev.overpass-api.de/overpass-doc/en/preface/commons.html
import { writeFileSync } from 'node:fs';
import { trimOverpass } from './trim.mjs';

const [id, ...nums] = process.argv.slice(2);
const [w, s, e, n] = nums.map(Number);
if (!id || [w, s, e, n].some((v) => !Number.isFinite(v))) {
  console.error('Usage: node scripts/fetch-area.mjs <id> <west> <south> <east> <north>');
  process.exit(1);
}
const bb = `${s},${w},${n},${e}`;
const query = `[out:json][timeout:90];
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
const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'User-Agent': 'ShadeWalk area fetcher (hackathon project)' },
  body: new URLSearchParams({ data: query }),
});
if (!res.ok) { console.error('Overpass error', res.status); process.exit(1); }
const json = trimOverpass(await res.json());
writeFileSync(`public/areas/${id}.json`, JSON.stringify(json));
console.log(`Saved public/areas/${id}.json with ${json.elements.length} elements`);
