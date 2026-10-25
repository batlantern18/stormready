import { httpJson } from './net/http';
import type { OfflineRoute, RoutePoint } from './offline-router';

type OsrmStep = {
  distance?: number;
  name?: string;
  maneuver?: { type?: string; modifier?: string; location?: [number, number] };
};

type OsrmResponse = {
  code?: string;
  routes?: {
    distance?: number;
    duration?: number;
    geometry?: { coordinates?: [number, number][] };
    legs?: { steps?: OsrmStep[] }[];
  }[];
};

function describeManeuver(step: OsrmStep) {
  const type = step.maneuver?.type || 'continue';
  const modifier = step.maneuver?.modifier;
  const road = step.name ? ` onto ${step.name}` : '';
  if (type === 'depart') return `Head${modifier ? ` ${modifier}` : ''}${road}`;
  if (type === 'arrive') return 'Arrive at your destination';
  if (type === 'turn') return `Turn ${modifier || 'ahead'}${road}`;
  if (type === 'merge') return `Merge${modifier ? ` ${modifier}` : ''}${road}`;
  if (type === 'on ramp') return `Take the ramp${modifier ? ` ${modifier}` : ''}${road}`;
  if (type === 'off ramp') return `Take the exit${modifier ? ` ${modifier}` : ''}${road}`;
  if (type === 'roundabout' || type === 'rotary') return `Enter the roundabout${road}`;
  if (type === 'uturn') return `Make a U-turn${road}`;
  if (type === 'new name') return `Continue${road}`;
  return `Continue${road}`;
}

/** Fetches a one-off driving route when the saved offline road graph cannot
 * connect the points. The route is usable for guidance now, but is not cached
 * as offline road data. */
export async function fetchOnlineDrivingRoute(origin: RoutePoint, destination: RoutePoint): Promise<OfflineRoute> {
  const coordinates = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?steps=true&overview=full&geometries=geojson`;
  const response = await httpJson<OsrmResponse>(url, {
    timeoutMs: 20_000,
    bodyTimeoutMs: 20_000,
    maxBytes: 4 * 1024 * 1024,
    retries: 0,
    userAgent: 'StormReady/1.1 (route fallback)',
  });
  const result = response.code === 'Ok' ? response.routes?.[0] : undefined;
  const coordinatesOut = result?.geometry?.coordinates;
  if (!result || !coordinatesOut || coordinatesOut.length < 2 || !Number.isFinite(result.distance) || !Number.isFinite(result.duration)) {
    throw new Error('No online driving route was found for these points.');
  }

  const steps = (result.legs || []).flatMap(leg => leg.steps || []).map(step => {
    const location = step.maneuver?.location;
    let coordinateIndex = 0;
    if (location) {
      let bestDistance = Number.POSITIVE_INFINITY;
      coordinatesOut.forEach(([longitude, latitude], index) => {
        const distance = (longitude - location[0]) ** 2 + (latitude - location[1]) ** 2;
        if (distance < bestDistance) { bestDistance = distance; coordinateIndex = index; }
      });
    }
    return {
      instruction: describeManeuver(step),
      distance: step.distance || 0,
      coordinateIndex,
    };
  });

  return {
    geometry: { type: 'LineString', coordinates: coordinatesOut },
    distance: result.distance!,
    duration: result.duration!,
    steps: steps.length ? steps : [{ instruction: 'Follow the route to your destination', distance: result.distance!, coordinateIndex: 0 }],
  };
}
