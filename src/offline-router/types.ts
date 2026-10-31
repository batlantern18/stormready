/**
 * offline-router — shared types and error classes for offline map data.
 *
 * A saved map area is a small, self-contained piece of the OpenStreetMap road
 * network plus the addresses and places inside it. The app downloads these in
 * tiles, stitches them into a routing graph, and answers routes entirely on
 * device — no connection, no tiles. This module holds only the shapes and the
 * three error classes the layers below share.
 */
export type RouteCoordinate = [number, number];
export type RouteBounds = [number, number, number, number];
export type RoadWay = {
  id: string;
  /** OSM node ids, one per coordinate. Older saved files have them; new
   * downloads leave them out because the rounded coordinates already join ways. */
  nodes?: string[];
  coordinates: RouteCoordinate[];
  name: string;
  highway: string;
  oneway: string;
};
export type OfflineRoadNetwork = {
  version: 1;
  bounds: RouteBounds;
  roads: RoadWay[];
  savedAt: string;
  /** Set when some map sections could not be downloaded, so the saved roads are
   * usable but incomplete. */
  partial?: boolean;
  /** How many map sections are missing from a partial download. */
  missingSections?: number;
};
export type OfflineDestination = {
  id: string;
  name: string;
  address: string;
  city: string;
  region: string;
  latitude: number;
  longitude: number;
};
export type OfflineDestinationIndex = {
  version: 1;
  bounds: RouteBounds;
  destinations: OfflineDestination[];
  savedAt: string;
  /** Set when part of the area could not be indexed; search still works for
   * the tiles that did arrive. */
  partial?: boolean;
  /** How many address sections are missing from a partial index. */
  missingSections?: number;
};
export type RouteStep = { instruction: string; distance: number; coordinateIndex: number };
export type OfflineRoute = {
  geometry: { type: 'LineString'; coordinates: RouteCoordinate[] };
  distance: number;
  duration: number;
  steps: RouteStep[];
};
export type RoutePoint = { latitude: number; longitude: number };

/** Thrown when a route cannot resolve because one or both points sit outside the
 * saved road network (or the network is disconnected). A larger/corridor network
 * downloaded on demand can fix it, so callers special-case this class. */
export class RouteOutOfAreaError extends Error {}

/** Thrown when the user stops a road data download. The area itself is fine —
 * only the offline roads are missing. */
export class RoadDownloadCancelledError extends Error {}

/** Thrown when a piece of road data is too large for the phone to keep. The
 * piece is worth asking for again in smaller pieces. */
export class RoadDataTooLargeError extends Error {}

/** How much detail a download asks for: `core` skips the small local roads,
 * `full` includes them. Shared by every download layer. */
export type RoadDetail = 'core' | 'full';

/** The roads a saved area starts with. Service roads, alleys and parking lanes
 * are the bulk of a city's road data — in a dense area they are most of the
 * payload — and they are only needed to reach a single address, so they are
 * added on demand instead of with every download. Shared by the road and
 * destination downloads because both filter Overpass on the same highway set. */
export const CORE_HIGHWAYS = 'motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street';
/** All the routable roads: the core plus the small local roads. */
export const ROUTABLE_HIGHWAYS = `${CORE_HIGHWAYS}|service|road`;
/** Estimated ceiling for a saved road file. Bigger than this and the parsed
 * network plus its graph needs more memory than a phone reliably has. Shared by
 * the road download and the network merge, which both guard against it. */
export const MAX_NETWORK_BYTES = 30 * 1024 * 1024;

