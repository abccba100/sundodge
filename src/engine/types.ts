export type LngLat = [number, number];

/** How a building height was obtained. */
export type HeightSource = 'height' | 'levels' | 'estimate';

export interface Building {
  id: number;
  /** Outer ring in local metres, flattened [x0, y0, x1, y1, ...], not closed. */
  ring: Float64Array;
  height: number;
  /** Height of the underside (m): 0 for a normal building, > 0 for an overhang, a roof on pillars or a bridge. */
  minHeight: number;
  heightSource: HeightSource;
  kind: string;
  /** Local bbox [minX, minY, maxX, maxY]. */
  bbox: [number, number, number, number];
}

export interface Tree {
  x: number;
  y: number;
  /** Canopy radius (m). */
  r: number;
  /** Canopy top (m). */
  top: number;
  /** Canopy bottom (m). */
  base: number;
}

export interface Graph {
  nodeX: Float64Array;
  nodeY: Float64Array;
  /** CSR adjacency: neighbours of node i are adj[adjStart[i] .. adjStart[i + 1]). */
  adjStart: Int32Array;
  adjTo: Int32Array;
  adjEdge: Int32Array;
  edgeA: Int32Array;
  edgeB: Int32Array;
  edgeLen: Float64Array;
  /** Highway tag per edge (for display and filtering). */
  edgeKind: string[];
  /** 1 if the edge is a tunnel, arcade or indoor passage. */
  edgeCovered: Uint8Array;
  /** Node belongs to the largest connected component. */
  nodeInMain: Uint8Array;
}

export interface Area {
  id: string;
  name: string;
  center: LngLat;
  bounds: [number, number, number, number];
  buildings: Building[];
  trees: Tree[];
  graph: Graph;
  /** Decorative polygons (parks, water) in lng/lat. */
  decor: { kind: 'park' | 'water'; rings: LngLat[][] }[];
  stats: AreaStats;
}

export interface AreaStats {
  buildings: number;
  buildingsWithHeight: number;
  buildingsWithLevels: number;
  trees: number;
  edges: number;
  walkKm: number;
}

export interface Sun {
  altitude: number;
  /** Azimuth measured clockwise from north, radians. */
  azimuth: number;
  /** Unit vector pointing toward the sun on the ground plane (x east, y north). */
  dir: [number, number];
}
