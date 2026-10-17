import SunCalc from 'suncalc';
import type { Sun } from './types';

/**
 * Sun position for a moment and place.
 * SunCalc 1.x reports azimuth from south, positive toward west.
 * We convert to "clockwise from north" so that x = sin(az), y = cos(az)
 * points toward the sun with x = east and y = north.
 */
export function sunAt(date: Date, lat: number, lng: number): Sun {
  const p = SunCalc.getPosition(date, lat, lng);
  const azimuth = normalize(p.azimuth + Math.PI);
  return {
    altitude: p.altitude,
    azimuth,
    dir: [Math.sin(azimuth), Math.cos(azimuth)],
  };
}

function normalize(a: number): number {
  const t = a % (2 * Math.PI);
  return t < 0 ? t + 2 * Math.PI : t;
}

/** Below this altitude we treat the whole street as shaded (sun at or under the skyline). */
export const MIN_SUN_ALTITUDE = (2 * Math.PI) / 180;

/** Longest shadow we model, to keep low-sun shadows finite (m). */
export const MAX_SHADOW_LENGTH = 400;

export function shadowLength(height: number, altitude: number): number {
  if (altitude <= MIN_SUN_ALTITUDE) return MAX_SHADOW_LENGTH;
  return Math.min(MAX_SHADOW_LENGTH, height / Math.tan(altitude));
}

export function sunTimes(date: Date, lat: number, lng: number) {
  const t = SunCalc.getTimes(date, lat, lng);
  return { sunrise: t.sunrise, sunset: t.sunset, solarNoon: t.solarNoon };
}
