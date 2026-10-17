import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MLMap, type Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './App.css';
import { DEMO_AREAS, MAX_LIVE_AREA_KM2, type DemoArea } from './areas';
import type { FromWorker, PlanRow, RouteOut, ToWorker } from './protocol';
import type { AreaStats, LngLat } from './engine/types';
import { fmtClock, minuteInZone, parseClock, zonedToDate } from './time';
import { fetchWeather, type WeatherHour } from './weather';
import { overpassQuery } from './data/osm';
import tzlookup from '@photostructure/tz-lookup';
import { sunWindow } from './sunwindow';
import { DepartureChart } from './ui/DepartureChart';

type Computed = Extract<FromWorker, { type: 'computed' }>;

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const BASE = import.meta.env.BASE_URL;

const emptyFC = (): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: [] });

export default function App() {
  const mapDiv = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const worker = useRef<Worker | null>(null);
  const markers = useRef<{ a?: Marker; b?: Marker }>({});
  const streetFC = useRef<GeoJSON.FeatureCollection>(emptyFC());
  const seq = useRef(0);
  const planSeq = useRef(0);
  /** Area id the worker is expected to hold next; 'loaded' messages for anything else are ignored. */
  const expectedLoad = useRef<string | null>(null);
  /** Bumped on every area switch so that a slow fetch for an older area is dropped. */
  const loadToken = useRef(0);
  const sentAt = useRef(new Map<number, number>());

  const [mapReady, setMapReady] = useState(false);
  const [area, setArea] = useState<DemoArea>(DEMO_AREAS[0]);
  const [stats, setStats] = useState<AreaStats | null>(null);
  const [loading, setLoading] = useState<string | null>('Loading map data…');
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState(DEMO_AREAS[0].date);
  const [minute, setMinute] = useState(parseClock(DEMO_AREAS[0].time));
  const [alpha, setAlpha] = useState(3);
  const [from, setFrom] = useState<LngLat | null>(DEMO_AREAS[0].from);
  const [to, setTo] = useState<LngLat | null>(DEMO_AREAS[0].to);
  const [placing, setPlacing] = useState<'a' | 'b'>('b');
  const [result, setResult] = useState<Computed | null>(null);
  const [plan, setPlan] = useState<(PlanRow | null)[] | null>(null);
  const [weather, setWeather] = useState<WeatherHour[] | null>(null);
  const [showConfidence, setShowConfidence] = useState(false);
  const [liveAsk, setLiveAsk] = useState(false);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);

  const depart = useMemo(() => zonedToDate(day, minute, area.tz), [day, minute, area.tz]);
  const sunInfo = useMemo(
    () => sunWindow(day, area.tz, (area.bounds[1] + area.bounds[3]) / 2, (area.bounds[0] + area.bounds[2]) / 2),
    [day, area],
  );

  // ---------- worker ----------
  useEffect(() => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      if (m.type === 'error') { setError(m.message); setLoading(null); return; }
      if (m.type === 'loaded') { if (m.id === expectedLoad.current) onLoaded(m); return; }
      if (m.type === 'computed') {
        if (m.seq !== seq.current) return;
        const t0 = sentAt.current.get(m.seq);
        sentAt.current.clear();
        setLatency(t0 === undefined ? null : performance.now() - t0);
        setResult(m); paintCompute(m);
      }
      if (m.type === 'planned') { if (m.seq === planSeq.current) setPlan(m.rows); }
    };
    return () => w.terminate();
  }, []);

  const send = (m: ToWorker) => worker.current?.postMessage(m);

  // ---------- map ----------
  useEffect(() => {
    if (!mapDiv.current) return;
    const m = new maplibregl.Map({
      container: mapDiv.current,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#efe9de' } }],
      },
      center: [126.978, 37.571],
      zoom: 15.4,
      pitch: 48,
      bearing: -12,
      attributionControl: false,
      maxPitch: 70,
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    m.addControl(new maplibregl.AttributionControl({
      compact: true,
      customAttribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors · Weather: <a href="https://open-meteo.com" target="_blank">Open-Meteo</a>',
    }));
    m.on('load', () => {
      m.addSource('decor', { type: 'geojson', data: emptyFC() });
      m.addSource('shadows', { type: 'geojson', data: emptyFC() });
      m.addSource('streets', { type: 'geojson', data: emptyFC() });
      m.addSource('trees', { type: 'geojson', data: emptyFC() });
      m.addSource('route-short', { type: 'geojson', data: emptyFC() });
      m.addSource('route-shady', { type: 'geojson', data: emptyFC() });
      m.addSource('buildings', { type: 'geojson', data: emptyFC() });
      m.addLayer({ id: 'park', type: 'fill', source: 'decor', filter: ['==', ['get', 'k'], 'park'], paint: { 'fill-color': '#d3e2c3' } });
      m.addLayer({ id: 'water', type: 'fill', source: 'decor', filter: ['==', ['get', 'k'], 'water'], paint: { 'fill-color': '#b8d2e6' } });
      m.addLayer({ id: 'shadow', type: 'fill', source: 'shadows', paint: { 'fill-color': '#a7b0c4', 'fill-antialias': false } });
      m.addLayer({
        id: 'street', type: 'line', source: 'streets',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.8, 17, 3],
          'line-color': ['interpolate', ['linear'], ['get', 's'], 0, '#8a97b8', 0.5, '#d9c4a3', 1, '#f3b779'],
        },
      });
      m.addLayer({
        id: 'tree', type: 'circle', source: 'trees',
        paint: {
          'circle-color': '#5e9a63', 'circle-opacity': 0.85,
          'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 14, ['*', ['get', 'r'], 0.18], 18, ['*', ['get', 'r'], 2.9]],
        },
      });
      m.addLayer({
        id: 'building', type: 'fill-extrusion', source: 'buildings',
        paint: {
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-color': '#d8d2c6',
          'fill-extrusion-opacity': 0.88,
          'fill-extrusion-vertical-gradient': true,
        },
      });
      m.addLayer({ id: 'route-short-line', type: 'line', source: 'route-short', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#374151', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 2.5, 17, 6], 'line-dasharray': [1, 1.4], 'line-opacity': 0.9 } });
      m.addLayer({ id: 'route-shady-casing', type: 'line', source: 'route-shady', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 6, 17, 12] } });
      m.addLayer({
        id: 'route-shady-line', type: 'line', source: 'route-shady', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 4, 17, 8],
          'line-color': ['interpolate', ['linear'], ['get', 's'], 0, '#0f766e', 0.4, '#0f766e', 0.6, '#f59e0b', 1, '#ea580c'],
        },
      });
      m.addLayer({
        id: 'route-covered', type: 'line', source: 'route-shady', filter: ['==', ['get', 'c'], 1], layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': '#6d28d9', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 4, 17, 8], 'line-dasharray': [1.2, 0.8] },
      });
      setMapReady(true);
    });
    m.on('click', (e) => {
      const p: LngLat = [e.lngLat.lng, e.lngLat.lat];
      setPlacingAndPoint(p);
    });
    map.current = m;
    return () => m.remove();
  }, []);

  const areaRef = useRef(area);
  areaRef.current = area;
  const placingRef = useRef(placing);
  placingRef.current = placing;
  const setPlacingAndPoint = (p: LngLat) => {
    if (placingRef.current === 'a') { setFrom(p); setPlacing('b'); }
    else setTo(p);
  };

  // ---------- area loading ----------
  const loadDemo = useCallback(async (a: DemoArea) => {
    const token = ++loadToken.current;
    setError(null);
    setLoading(`Loading ${a.name}…`);
    setResult(null); setPlan(null);
    try {
      const r = await fetch(BASE + a.file);
      if (!r.ok) throw new Error(`Could not load ${a.file} (${r.status})`);
      const json = await r.json();
      if (token !== loadToken.current) return; // the user picked another area meanwhile
      expectedLoad.current = a.id;
      send({ type: 'load', id: a.id, name: a.name, bounds: a.bounds, json });
    } catch (e) {
      if (token !== loadToken.current) return;
      setError(String(e instanceof Error ? e.message : e));
      setLoading(null);
    }
  }, []);

  /** Forget everything computed for the previous area. */
  const resetForSwitch = () => {
    seq.current++; planSeq.current++;
    expectedLoad.current = null;
    setResult(null); setPlan(null); setLoadedId(null); setLatency(null);
    const mm = map.current;
    if (mm && mapReady) for (const id of ['route-short', 'route-shady', 'shadows']) (mm.getSource(id) as GeoJSONSource | undefined)?.setData(emptyFC());
  };

  useEffect(() => {
    // Load the first demo area once the map is ready; later switches go through pickArea.
    if (mapReady) loadDemo(areaRef.current);
  }, [mapReady, loadDemo]);

  function onLoaded(m: Extract<FromWorker, { type: 'loaded' }>) {
    const mm = map.current!;
    setStats(m.stats);
    setLoadedId(m.id);
    setLoading(null);
    (mm.getSource('buildings') as GeoJSONSource).setData(m.buildings);
    const feats: GeoJSON.Feature[] = [];
    for (let e = 0; e < m.streets.length / 4; e++) {
      feats.push({ type: 'Feature', id: e, properties: { s: 0.5 }, geometry: { type: 'LineString', coordinates: [[m.streets[4 * e], m.streets[4 * e + 1]], [m.streets[4 * e + 2], m.streets[4 * e + 3]]] } });
    }
    streetFC.current = { type: 'FeatureCollection', features: feats };
    (mm.getSource('streets') as GeoJSONSource).setData(streetFC.current);
    const tf: GeoJSON.Feature[] = [];
    for (let i = 0; i < m.trees.length / 3; i++) tf.push({ type: 'Feature', properties: { r: m.trees[3 * i + 2] }, geometry: { type: 'Point', coordinates: [m.trees[3 * i], m.trees[3 * i + 1]] } });
    (mm.getSource('trees') as GeoJSONSource).setData({ type: 'FeatureCollection', features: tf });
    const a = areaRef.current;
    if (a.from && a.to) {
      const xs = [a.from[0], a.to[0]], ys = [a.from[1], a.to[1]];
      mm.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: { top: 120, bottom: 120, left: 80, right: 80 }, pitch: 50, bearing: -15, duration: 0, maxZoom: 17 });
    } else {
      const [w, s, e, n] = m.bounds;
      mm.fitBounds([[w, s], [e, n]], { padding: 40, pitch: 48, bearing: -12, duration: 0 });
    }
  }

  function paintCompute(m: Computed) {
    const mm = map.current;
    if (!mm) return;
    (mm.getSource('shadows') as GeoJSONSource).setData(m.shadows);
    const fc = streetFC.current;
    for (let e = 0; e < fc.features.length; e++) (fc.features[e].properties as { s: number }).s = m.night ? 0 : m.edgeSun[e];
    (mm.getSource('streets') as GeoJSONSource).setData(fc);
    const routeFC = (r: RouteOut | null): GeoJSON.FeatureCollection => r
      ? {
          type: 'FeatureCollection',
          features: r.segSun.map((s, i) => ({ type: 'Feature', properties: { s, c: r.segCovered[i] }, geometry: { type: 'LineString', coordinates: [r.coords[i], r.coords[i + 1]] } })),
        }
      : emptyFC();
    (mm.getSource('route-short') as GeoJSONSource).setData(routeFC(m.shortest));
    (mm.getSource('route-shady') as GeoJSONSource).setData(routeFC(m.shady));
    const azDeg = (m.sunAz * 180) / Math.PI;
    const polar = Math.max(0, Math.min(90, 90 - (m.sunAlt * 180) / Math.PI));
    mm.setLight({ anchor: 'map', position: [1.5, azDeg, polar], intensity: m.night ? 0.15 : 0.45, color: '#ffffff' });
  }

  // ---------- compute on change ----------
  useEffect(() => {
    if (!loadedId) return;
    const id = ++seq.current;
    const t = setTimeout(() => {
      sentAt.current.set(id, performance.now());
      send({ type: 'compute', seq: id, departISO: depart.toISOString(), alpha, from, to });
    }, 30);
    return () => clearTimeout(t);
  }, [loadedId, depart, alpha, from, to]);

  useEffect(() => {
    if (!loadedId || !from || !to) { setPlan(null); return; }
    const id = ++planSeq.current;
    const t = setTimeout(() => {
      const times: string[] = [];
      for (let k = -6; k <= 6; k++) times.push(zonedToDate(day, minute + k * 10, area.tz).toISOString());
      send({ type: 'plan', seq: id, timesISO: times, alpha, from, to });
    }, 450);
    return () => clearTimeout(t);
  }, [loadedId, day, minute, alpha, from, to, area.tz]);

  useEffect(() => {
    let alive = true;
    const lat = (area.bounds[1] + area.bounds[3]) / 2, lng = (area.bounds[0] + area.bounds[2]) / 2;
    fetchWeather(lat, lng, day, area.tz).then((w) => { if (alive) setWeather(w); });
    return () => { alive = false; };
  }, [day, area]);

  // ---------- markers ----------
  useEffect(() => {
    const mm = map.current;
    if (!mm || !mapReady) return;
    const sync = (key: 'a' | 'b', p: LngLat | null, label: string, cls: string, set: (p: LngLat) => void) => {
      if (!p) { markers.current[key]?.remove(); markers.current[key] = undefined; return; }
      if (!markers.current[key]) {
        const el = document.createElement('div');
        el.className = `pin ${cls}`;
        el.textContent = label;
        const mk = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(p).addTo(mm);
        mk.on('dragend', () => { const ll = mk.getLngLat(); set([ll.lng, ll.lat]); });
        markers.current[key] = mk;
      } else markers.current[key]!.setLngLat(p);
    };
    sync('a', from, 'A', 'pin-a', setFrom);
    sync('b', to, 'B', 'pin-b', setTo);
  }, [from, to, mapReady]);

  // ---------- actions ----------
  const pickArea = (id: string) => {
    const a = DEMO_AREAS.find((x) => x.id === id);
    if (!a) return;
    resetForSwitch();
    setArea(a); setDay(a.date); setMinute(parseClock(a.time)); setFrom(a.from); setTo(a.to);
    loadDemo(a);
  };

  const viewBounds = (): [number, number, number, number] | null => {
    const mm = map.current;
    if (!mm) return null;
    const c = mm.getCenter();
    const b = mm.getBounds();
    // clamp to MAX_LIVE_AREA_KM2 around the centre
    const kx = Math.cos((c.lat * Math.PI) / 180) * 111.32, ky = 110.57;
    let halfW = ((b.getEast() - b.getWest()) / 2) * kx, halfH = ((b.getNorth() - b.getSouth()) / 2) * ky;
    const scale = Math.sqrt(MAX_LIVE_AREA_KM2 / Math.max(1e-6, 4 * halfW * halfH));
    if (scale < 1) { halfW *= scale; halfH *= scale; }
    return [c.lng - halfW / kx, c.lat - halfH / ky, c.lng + halfW / kx, c.lat + halfH / ky];
  };

  const lastLive = useRef(0);
  const loadLive = async () => {
    setLiveAsk(false);
    const wait = 60000 - (Date.now() - lastLive.current);
    if (wait > 0) { setError(`Please wait ${Math.ceil(wait / 1000)} s before loading another area — the Overpass API is a shared, volunteer-run service.`); return; }
    lastLive.current = Date.now();
    const bb = viewBounds();
    if (!bb) return;
    const token = ++loadToken.current;
    setError(null);
    setLoading('Downloading streets, buildings and trees from OpenStreetMap…');
    const q = overpassQuery(bb);
    let json: { elements?: unknown[]; remark?: string } | null = null;
    let problem = '';
    for (const ep of OVERPASS) {
      try {
        const r = await fetch(ep, { method: 'POST', body: new URLSearchParams({ data: q }), signal: AbortSignal.timeout(100_000) });
        if (!r.ok) { problem = `HTTP ${r.status}`; continue; }
        const j = await r.json();
        // Overpass reports timeouts and memory limits with HTTP 200 and a "remark"; the data is then incomplete.
        if (!Array.isArray(j.elements) || j.remark) { problem = j.remark ? String(j.remark).slice(0, 120) : 'no data'; continue; }
        json = j; break;
      } catch (e) { problem = e instanceof Error ? e.name : 'network error'; }
    }
    if (token !== loadToken.current) return; // the user switched areas while we waited
    if (!json) { setLoading(null); setError(`The Overpass API could not deliver this area (${problem}). It is a free shared service — please try again in a minute, or zoom in.`); return; }
    if (json.elements!.length === 0) { setLoading(null); setError('OpenStreetMap has no streets or buildings here. Try a town or city.'); return; }
    const c: LngLat = [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
    // Use the time zone of the place on screen, not the viewer's, so clock, sunrise and weather are local.
    let tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    try { tz = tzlookup(c[1], c[0]); } catch { /* keep the browser zone */ }
    const live: DemoArea = {
      id: `live-${bb.map((v) => v.toFixed(4)).join('_')}`, name: 'This view', city: 'Custom', file: '', bounds: bb, tz,
      from: [c[0] - (bb[2] - bb[0]) / 4, c[1]], to: [c[0] + (bb[2] - bb[0]) / 4, c[1]], fromLabel: 'A', toLabel: 'B',
      date: day, time: fmtClock(minute), story: 'Loaded live from OpenStreetMap for the area on screen.',
    };
    resetForSwitch();
    setArea(live); setFrom(live.from); setTo(live.to);
    expectedLoad.current = live.id;
    send({ type: 'load', id: live.id, name: live.name, bounds: bb, json });
  };

  useEffect(() => {
    const mm = map.current;
    if (!mm || !mapReady) return;
    mm.setPaintProperty('building', 'fill-extrusion-color', showConfidence
      ? ['match', ['get', 'src'], 'height', '#7aa77a', 'levels', '#c9b458', '#d98c6a']
      : '#d8d2c6');
  }, [showConfidence, mapReady]);

  // ---------- derived ----------
  const sh = result?.shortest, sd = result?.shady;
  const wx = weather?.find((h) => h.time.slice(11, 13) === String(Math.floor(minute / 60)).padStart(2, '0')) ?? null;
  const sunDeg = result ? (result.sunAlt * 180) / Math.PI : null;
  const heightPct = stats ? Math.round(((stats.buildingsWithHeight + stats.buildingsWithLevels) / Math.max(1, stats.buildings)) * 100) : null;
  const best = plan ? pickBest(plan) : null;

  return (
    <div className="app">
      <aside className="panel">
        <header className="brand">
          <h1>SunDodge</h1>
          <p>Less sun on your walk.</p>
        </header>

        <section className="card">
          <label className="lbl" htmlFor="area">Area</label>
          <div className="row">
            <select id="area" value={area.file ? area.id : ''} onChange={(e) => pickArea(e.target.value)}>
              {!area.file && <option value="">This view (live)</option>}
              {DEMO_AREAS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button className="ghost" onClick={() => setLiveAsk(true)} title="Load OpenStreetMap data for the area on screen">Load this view</button>
          </div>
          <p className="story">{area.story}</p>
          {area.file && <p className="story walk">Demo walk: <strong>A</strong> {area.fromLabel} → <strong>B</strong> {area.toLabel}</p>}
        </section>

        <section className="card">
          <div className="row between">
            <label className="lbl" htmlFor="day">Date</label>
            <input id="day" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
          </div>
          <div className="row between">
            <label className="lbl" htmlFor="time">Leave at <strong className="clock">{fmtClock(minute)}</strong></label>
            <span className="sun">{sunDeg === null ? '' : sunDeg <= 0 ? 'Sun is down' : sunDeg < 2 ? 'Sun on the horizon' : `Sun ${sunDeg.toFixed(0)}° high`}</span>
          </div>
          <input id="time" type="range" min={sunInfo.min} max={sunInfo.max} step={5} value={minute} onChange={(e) => setMinute(+e.target.value)} />
          <div className="ticks">
            {sunInfo.kind === 'normal' && <><span>{fmtClock(sunInfo.rise)} sunrise</span><span>sunset {fmtClock(sunInfo.set)}</span></>}
            {sunInfo.kind === 'wrap' && <><span>00:00</span><span>sunrise {fmtClock(sunInfo.rise)} · sunset {fmtClock(sunInfo.set)} (after midnight)</span></>}
            {sunInfo.kind === 'polar-day' && <><span>00:00</span><span>midnight sun — the sun does not set</span></>}
            {sunInfo.kind === 'polar-night' && <><span>00:00</span><span>polar night — the sun does not rise</span></>}
          </div>
          {wx && (
            <p className="weather">
              Feels like <strong>{Math.round(wx.feels)}°C</strong> · air {Math.round(wx.temp)}°C{wx.uv !== null ? ` · UV ${wx.uv.toFixed(0)}` : ''} · direct sun {Math.round(wx.direct)} W/m²
              {wx.cloud >= 70 ? <span className="note"> — cloudy: shade matters less right now</span>
                : wx.direct < 120 ? <span className="note"> — low sun: direct heat is weak right now</span> : null}
            </p>
          )}
        </section>

        <section className="card">
          <div className="row between">
            <label className="lbl" htmlFor="alpha">How much to avoid sun</label>
            <span className="alpha">{alpha === 1 ? 'off' : `1 m of sun = ${alpha} m of shade`}</span>
          </div>
          <input id="alpha" type="range" min={1} max={6} step={0.5} value={alpha} onChange={(e) => setAlpha(+e.target.value)} />
          <div className="row place">
            <span>Click the map to move</span>
            <button className={placing === 'a' ? 'chip on' : 'chip'} onClick={() => setPlacing('a')}>A · start</button>
            <button className={placing === 'b' ? 'chip on' : 'chip'} onClick={() => setPlacing('b')}>B · end</button>
          </div>
        </section>

        {sh && sd && (
          <section className="card results">
            <table>
              <thead><tr><th></th><th>Walk</th><th>In sun</th><th>Shade</th></tr></thead>
              <tbody>
                <tr><td><span className="key key-short" />Shortest</td><td>{sh.minutes.toFixed(1)} min</td><td>{sh.sunMinutes.toFixed(1)} min</td><td>{sh.shadePct.toFixed(0)}%</td></tr>
                <tr className="hl"><td><span className="key key-shady" />SunDodge</td><td>{sd.minutes.toFixed(1)} min</td><td>{sd.sunMinutes.toFixed(1)} min</td><td>{sd.shadePct.toFixed(0)}%</td></tr>
              </tbody>
            </table>
            <p className="verdict">{verdict(sh, sd)}</p>
            {(sd.coveredM >= 10 || sh.coveredM >= 10) && (
              <p className="small covered-note">
                <span className="key key-covered" />Covered walkways (arcades, covered alleys, underground or indoor passages) count as shade:
                {' '}{sd.coveredMinutes.toFixed(1)} min of the SunDodge route{sh.coveredM >= 10 ? `, ${sh.coveredMinutes.toFixed(1)} min of the shortest` : ''}.
              </p>
            )}
          </section>
        )}

        {plan && sd && (
          <section className="card">
            <h2>When to leave</h2>
            <DepartureChart rows={plan} current={zonedToDate(day, minute, area.tz).toISOString()} tz={area.tz} onPick={(iso) => setMinute(minuteInZone(new Date(iso), area.tz))} />
            {best && best.gainMin >= 1 && (
              <p className="tip">
                Leave at <button className="link" onClick={() => setMinute(minuteInZone(new Date(best.time), area.tz))}>{fmtClock(minuteInZone(new Date(best.time), area.tz))}</button> to cut sun to {best.sunMin.toFixed(1)} min ({best.gainMin.toFixed(1)} min less than now).
                {feelsAt(weather, best.time, area.tz, wx)}
              </p>
            )}
            {best && best.gainMin < 1 && <p className="tip">Within an hour either way, timing barely changes your sun minutes here. The route matters more.</p>}
          </section>
        )}

        <section className="card small">
          {stats && (
            <p>
              {stats.buildings.toLocaleString()} buildings · {stats.trees.toLocaleString()} mapped trees · {stats.walkKm.toFixed(0)} km of walkways.
              {' '}Heights: {heightPct}% from OpenStreetMap tags, the rest estimated by building type.
              <label className="toggle"><input type="checkbox" checked={showConfidence} onChange={(e) => setShowConfidence(e.target.checked)} /> Show height data quality</label>
            </p>
          )}
          {showConfidence && <p className="legend"><span className="sw g" />height tag <span className="sw y" />floors × 3 m <span className="sw r" />estimated</p>}
          <p className="legend"><span className="sw sun" />street in sun <span className="sw shade" />street in shade <span className="sw shadow" />shadow</p>
          <p className="legend"><span className="key key-shady" />route in shade <span className="key key-part" />partly sunny <span className="key key-sunny" />in sun <span className="key key-covered" />covered walkway <span className="key key-short" />shortest</p>
          {result && <p className="muted">Updated in {Math.round(latency ?? result.ms)} ms (shadows and both routes: {result.ms.toFixed(0)} ms), in your browser.</p>}
        </section>
      </aside>

      <main className="mapwrap">
        <div ref={mapDiv} className="map" />
        {loading && <div className="overlay">{loading}</div>}
        {error && <div className="overlay err" onClick={() => setError(null)}>{error}</div>}
        {result?.night && <div className="badge">The sun is at or below the horizon — every street counts as shade.</div>}
        {liveAsk && (
          <div className="modal-bg">
            <div className="modal">
              <h3>Load this area from OpenStreetMap?</h3>
              <p>SunDodge will send one request to the free, volunteer-run Overpass API for streets, buildings and trees in up to {MAX_LIVE_AREA_KM2} km² around the map centre. Please don’t repeat it many times.</p>
              <div className="row end">
                <button className="ghost" onClick={() => setLiveAsk(false)}>Cancel</button>
                <button onClick={loadLive}>Load</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function verdict(sh: RouteOut, sd: RouteOut): string {
  const extra = sd.minutes - sh.minutes;
  const saved = sh.sunMinutes - sd.sunMinutes;
  if (saved < 0.3) return 'The shortest way is already about as shady as it gets right now.';
  const pct = sh.sunMinutes > 0 ? Math.round((saved / sh.sunMinutes) * 100) : 0;
  return `${extra < 0.3 ? 'Same walking time' : `+${extra.toFixed(1)} min walking`}, ${saved.toFixed(1)} min less in direct sun (−${pct}%).`;
}

/** "Feels like 41 °C then (now 43 °C)." from the hourly weather, if we have it. */
function feelsAt(weather: WeatherHour[] | null, iso: string, tz: string, now: WeatherHour | null): string {
  if (!weather || !now) return '';
  const h = String(Math.floor(minuteInZone(new Date(iso), tz) / 60)).padStart(2, '0');
  const w = weather.find((x) => x.time.slice(11, 13) === h);
  if (!w || w === now) return '';
  return ` Feels like ${Math.round(w.feels)}°C then (now ${Math.round(now.feels)}°C).`;
}

function pickBest(rows: (PlanRow | null)[]): { time: string; sunMin: number; gainMin: number } | null {
  const ok = rows.filter((r): r is PlanRow => !!r && !r.night);
  if (!ok.length) return null;
  const mid = rows[Math.floor(rows.length / 2)];
  const best = ok.reduce((a, b) => (b.shadySunMin < a.shadySunMin - 0.05 ? b : a));
  return { time: best.time, sunMin: best.shadySunMin, gainMin: (mid?.shadySunMin ?? best.shadySunMin) - best.shadySunMin };
}
