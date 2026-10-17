import type { LngLat } from './types';

/**
 * Local equirectangular projection around a reference point.
 * Error is well under 0.5% for areas a few kilometres across, which is
 * far below the uncertainty of OpenStreetMap building heights.
 */
export interface Projection {
  lat0: number;
  lng0: number;
  toXY(lng: number, lat: number): [number, number];
  toLL(x: number, y: number): LngLat;
}

const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LNG_EQ = 111320;

export function makeProjection(lng0: number, lat0: number): Projection {
  const kx = Math.cos((lat0 * Math.PI) / 180) * M_PER_DEG_LNG_EQ;
  const ky = M_PER_DEG_LAT;
  return {
    lat0,
    lng0,
    toXY: (lng, lat) => [(lng - lng0) * kx, (lat - lat0) * ky],
    toLL: (x, y) => [lng0 + x / kx, lat0 + y / ky],
  };
}
