import type { AreaStats, LngLat } from './engine/types';

export type ToWorker =
  | { type: 'load'; id: string; name: string; bounds: [number, number, number, number]; json: unknown }
  | { type: 'compute'; seq: number; departISO: string; alpha: number; from: LngLat | null; to: LngLat | null }
  | { type: 'plan'; seq: number; timesISO: string[]; alpha: number; from: LngLat; to: LngLat };

export interface RouteOut {
  coords: LngLat[];
  /** Sun fraction of each segment (same order as coords pairs). */
  segSun: number[];
  /** 1 where the segment is a covered way (arcade, covered alley, underground or indoor passage). */
  segCovered: number[];
  lengthM: number;
  minutes: number;
  sunMinutes: number;
  sunM: number;
  treeM: number;
  coveredM: number;
  coveredMinutes: number;
  shadePct: number;
}

export interface PlanRow {
  time: string;
  shortestSunMin: number;
  shadySunMin: number;
  shadyMin: number;
  shortestMin: number;
  night: boolean;
}

export type FromWorker =
  | {
      type: 'loaded'; id: string; stats: AreaStats; center: LngLat; bounds: [number, number, number, number];
      buildings: GeoJSON.FeatureCollection; streets: Float32Array; trees: Float32Array; ms: number;
    }
  | {
      type: 'computed'; seq: number; sunAlt: number; sunAz: number; night: boolean; evalISO: string;
      shadows: GeoJSON.FeatureCollection; edgeSun: Float32Array;
      shortest: RouteOut | null; shady: RouteOut | null; ms: number;
    }
  | { type: 'planned'; seq: number; rows: (PlanRow | null)[] }
  | { type: 'error'; message: string };
