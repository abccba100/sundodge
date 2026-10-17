import type { LngLat } from './engine/types';

export interface DemoArea {
  id: string;
  name: string;
  city: string;
  file: string;
  bounds: [number, number, number, number];
  tz: string;
  from: LngLat;
  to: LngLat;
  fromLabel: string;
  toLabel: string;
  /** Demo date and time in the area's local time zone. */
  date: string;
  time: string;
  story: string;
}

/**
 * Pre-cached demo areas. Data: OpenStreetMap contributors (ODbL), fetched once
 * with scripts/fetch-area.mjs through the Overpass API and stored as static files.
 */
export const DEMO_AREAS: DemoArea[] = [
  {
    id: 'seoul-jongno',
    name: 'Jongno, Seoul',
    city: 'Seoul',
    file: 'areas/seoul-jongno.json',
    bounds: [126.968, 37.565, 126.988, 37.578],
    tz: 'Asia/Seoul',
    from: [126.9767, 37.5712],
    to: [126.9870, 37.5705],
    fromLabel: 'Gwanghwamun Square',
    toLabel: 'Jongno 2-ga',
    date: '2026-08-05',
    time: '15:30',
    story: '5 August 2026 had the highest feels-like temperature of the summer for central Seoul in Open-Meteo’s reanalysis (model data, about 44 °C). In Korea, 522 heat-illness cases in 2025 happened on the roadside, and cases peaked between 2 and 5 pm.',
  },
  {
    id: 'nyc-midtown',
    name: 'Midtown, New York',
    city: 'New York',
    file: 'areas/nyc-midtown.json',
    bounds: [-73.995, 40.748, -73.975, 40.762],
    tz: 'America/New_York',
    from: [-73.9910, 40.7502],
    to: [-73.9787, 40.7587],
    fromLabel: 'Penn Station',
    toLabel: 'Rockefeller Center',
    date: '2026-07-02',
    time: '14:00',
    story: '2 July 2026 had the highest feels-like temperature of the summer for Midtown in Open-Meteo’s reanalysis (model data, about 44 °C). Most buildings here have a real height or floor count in OpenStreetMap, so the shadow model has good data.',
  },
];

export const MAX_LIVE_AREA_KM2 = 2.5;
