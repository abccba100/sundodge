// Keep only what ShadeWalk reads, so bundled area files stay small.
const KEEP = new Set(['building', 'height', 'building:levels', 'roof:levels', 'highway', 'foot', 'access', 'tunnel', 'covered', 'indoor',
  'natural', 'leisure', 'landuse', 'diameter_crown', 'type']);
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const pt = (p) => (p ? { lat: r6(p.lat), lon: r6(p.lon) } : null);
export function trimOverpass(json) {
  const elements = json.elements.map((el) => {
    const tags = {};
    for (const [k, v] of Object.entries(el.tags ?? {})) if (KEEP.has(k)) tags[k] = v;
    const out = { type: el.type, id: el.id, tags };
    if (el.type === 'node') { out.lat = r6(el.lat); out.lon = r6(el.lon); }
    if (el.nodes) out.nodes = el.nodes;
    if (el.geometry) out.geometry = el.geometry.map(pt);
    if (el.members) out.members = el.members.filter((m) => m.role === 'outer').map((m) => ({ type: m.type, role: m.role, ref: m.ref, geometry: m.geometry?.map(pt) }));
    return out;
  });
  return { version: json.version, generator: json.generator, osm3s: json.osm3s, elements };
}

// CLI: node scripts/trim.mjs in.json out.json
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const [inp, outp] = process.argv.slice(2);
  const j = trimOverpass(JSON.parse(readFileSync(inp, 'utf8')));
  writeFileSync(outp, JSON.stringify(j));
  console.log(`${outp}: ${j.elements.length} elements`);
}
