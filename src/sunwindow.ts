import { sunAt, sunTimes } from './engine/sun';
import { minuteInZone, zonedToDate } from './time';

export type SunWindowKind = 'normal' | 'polar-day' | 'polar-night' | 'wrap';

export interface SunWindow {
  /** Sunrise and sunset as minutes of the local day, or NaN in polar day/night. */
  rise: number;
  set: number;
  /** Range for the time slider (minutes of the local day, step 5). */
  min: number;
  max: number;
  kind: SunWindowKind;
}

const valid = (d: Date) => d instanceof Date && !Number.isNaN(d.getTime());

/**
 * Daylight window for a date and place, in the area's own time zone.
 * Handles midnight sun and polar night (SunCalc returns Invalid Date there) and
 * places where sunset falls after local midnight (e.g. Reykjavik in June).
 */
export function sunWindow(day: string, tz: string, lat: number, lng: number): SunWindow {
  const noon = zonedToDate(day, 720, tz);
  const t = sunTimes(noon, lat, lng);
  if (!valid(t.sunrise) || !valid(t.sunset)) {
    const kind: SunWindowKind = sunAt(valid(t.solarNoon) ? t.solarNoon : noon, lat, lng).altitude > 0 ? 'polar-day' : 'polar-night';
    return { rise: NaN, set: NaN, min: 0, max: 1435, kind };
  }
  const rise = minuteInZone(t.sunrise, tz);
  const set = minuteInZone(t.sunset, tz);
  if (set <= rise) return { rise, set, min: 0, max: 1435, kind: 'wrap' };
  return { rise, set, min: Math.max(0, rise - 30), max: Math.min(1435, set + 30), kind: 'normal' };
}
