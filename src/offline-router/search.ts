/**
 * offline-router · search — corridor bounds and offline name/address search.
 *
 * The small geometry helpers that sit between the download layer and the routing
 * graph: the padded bounding box a trip downloads, containment checks, and the
 * name/address search over a saved destination index. Shared shapes come from
 * `./types`.
 */
import {
  type OfflineDestination,
  type OfflineDestinationIndex,
  type RouteBounds,
  type RoutePoint,
} from './types';

export function corridorBounds(start: RoutePoint, destination: RoutePoint, padDeg = 0.02): RouteBounds {
  const west = Math.min(start.longitude, destination.longitude) - padDeg;
  const south = Math.min(start.latitude, destination.latitude) - padDeg;
  const east = Math.max(start.longitude, destination.longitude) + padDeg;
  const north = Math.max(start.latitude, destination.latitude) + padDeg;
  return [west, south, east, north] as const;
}

export function boundsInclude(bounds: RouteBounds, target: RouteBounds) {
  return bounds[0] <= target[0] && bounds[1] <= target[1] && bounds[2] >= target[2] && bounds[3] >= target[3];
}

function normalizeSearchText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/\b(st)\b/g, 'street').replace(/\b(rd)\b/g, 'road').replace(/\b(ave)\b/g, 'avenue').replace(/\b(blvd)\b/g, 'boulevard').replace(/\b(dr)\b/g, 'drive').replace(/\b(ln)\b/g, 'lane').replace(/\b(hwy)\b/g, 'highway').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function searchOfflineDestinations(index: OfflineDestinationIndex, query: string, limit = 6): OfflineDestination[] {
  const normalized = normalizeSearchText(query);
  const terms = normalized.split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const matches = index.destinations.flatMap(destination => {
    const full = normalizeSearchText(`${destination.name} ${destination.address} ${destination.city} ${destination.region}`);
    if (!terms.every(term => full.includes(term))) return [];
    const exact = full === normalized ? 0 : full.startsWith(normalized) ? 1 : 2;
    const ordered = full.indexOf(terms.join(' ')) >= 0 ? 0 : 1;
    return [{ destination, score: exact * 2 + ordered }];
  });
  return matches.sort((a, b) => a.score - b.score || a.destination.name.localeCompare(b.destination.name)).slice(0, limit).map(match => match.destination);
}

