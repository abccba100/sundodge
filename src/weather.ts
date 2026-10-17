/**
 * Hourly weather from Open-Meteo (free for non-commercial use, no API key,
 * CC BY 4.0). Optional: the app works without it.
 */
export interface WeatherHour {
  time: string; // local ISO hour, e.g. 2026-08-05T15:00
  temp: number;
  feels: number;
  direct: number; // direct radiation, W/m2
  cloud: number; // %
  uv: number | null;
}

const cache = new Map<string, WeatherHour[] | null>();

export async function fetchWeather(lat: number, lng: number, day: string, tz: string): Promise<WeatherHour[] | null> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)},${day}`;
  if (cache.has(key)) return cache.get(key)!;
  const today = new Date();
  const d = new Date(`${day}T12:00:00`);
  const diffDays = (d.getTime() - today.getTime()) / 86400000;
  // Past days come from the historical archive (reanalysis, available after about 5 days);
  // recent and future days from the forecast API (up to 16 days ahead).
  const base = diffDays < -6 ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
  if (diffDays > 15) { cache.set(key, null); return null; }
  const core = 'temperature_2m,apparent_temperature,direct_radiation,cloud_cover';
  const urlFor = (vars: string) => `${base}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&hourly=${vars}&timezone=${encodeURIComponent(tz)}&start_date=${day}&end_date=${day}`;
  try {
    let r = await fetch(urlFor(base.includes('archive') ? core : core + ',uv_index'));
    if (!r.ok) r = await fetch(urlFor(core)); // UV is optional
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    const h = j.hourly;
    const rows: WeatherHour[] = h.time
      .map((t: string, i: number) => ({
        time: t,
        temp: h.temperature_2m[i],
        feels: h.apparent_temperature[i],
        direct: h.direct_radiation[i],
        cloud: h.cloud_cover[i],
        uv: h.uv_index ? h.uv_index[i] : null,
      }))
      .filter((w: WeatherHour) => w.temp !== null && w.feels !== null && w.direct !== null);
    if (!rows.length) throw new Error('no data');
    cache.set(key, rows);
    return rows;
  } catch {
    cache.set(key, null);
    return null;
  }
}
