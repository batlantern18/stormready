import type * as GeoJSON from 'geojson';
import { httpJson } from './net/http';

export type Shelter = {
  id: string;
  name: string;
  address: string;
  city: string;
  phone: string;
  pets: string;
  wheelchair: string;
  latitude: number;
  longitude: number;
  distance: number;
};
export type ShelterSearchPlace = { latitude: number; longitude: number; countryCode: 'US' | 'MX' };

const FEMA_OPEN_SHELTERS = 'https://gis.fema.gov/arcgis/rest/services/NSS/FEMA_NSS/FeatureServer/0/query';
const OVERPASS = 'https://overpass-api.de/api/interpreter';

function distanceMiles(a: number, b: number, c: number, d: number) {
  const rad = (n: number) => n * Math.PI / 180;
  const x = Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

async function findUsShelters(place: ShelterSearchPlace): Promise<Shelter[]> {
  const params = new URLSearchParams({
    where: 'state IS NOT NULL', geometry: `${place.longitude},${place.latitude}`, geometryType: 'esriGeometryPoint',
    inSR: '4326', distance: '50000', units: 'esriSRUnit_Meter',
    outFields: 'shelter_name,address_1,city,org_main_phone,pet_accommodations_desc,wheelchair_accessible',
    returnGeometry: 'true', outSR: '4326', f: 'geojson', resultRecordCount: '1000',
  });
  const features: GeoJSON.Feature<GeoJSON.Point, Record<string, unknown>>[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    params.set('resultOffset', String(offset));
    let data: { features?: GeoJSON.Feature<GeoJSON.Point, Record<string, unknown>>[]; exceededTransferLimit?: boolean };
    try {
      data = await httpJson(`${FEMA_OPEN_SHELTERS}?${params.toString()}`, {
        timeoutMs: 20_000,
        userAgent: 'StormReady/1.1 (FEMA shelter lookup)',
      });
    } catch {
      throw new Error('The FEMA shelter directory is unavailable.');
    }
    const page = data.features || [];
    features.push(...page);
    hasMore = Boolean(data.exceededTransferLimit && page.length);
    offset += page.length;
  }
  return features.flatMap((feature, index) => {
    const coords = feature.geometry?.coordinates;
    if (!coords || coords.length < 2) return [];
    const p = feature.properties || {};
    return [{
      id: String(feature.id ?? index), name: String(p.shelter_name || 'Emergency shelter'), address: String(p.address_1 || ''),
      city: String(p.city || ''), phone: String(p.org_main_phone || ''), pets: String(p.pet_accommodations_desc || ''),
      wheelchair: String(p.wheelchair_accessible || ''), longitude: coords[0], latitude: coords[1],
      distance: distanceMiles(place.latitude, place.longitude, coords[1], coords[0]),
    }];
  }).sort((a, b) => a.distance - b.distance);
}

async function findMexicoShelters(place: ShelterSearchPlace): Promise<Shelter[]> {
  const query = `[out:json][timeout:25];(node(around:50000,${place.latitude},${place.longitude})["emergency"="shelter"];way(around:50000,${place.latitude},${place.longitude})["emergency"="shelter"];relation(around:50000,${place.latitude},${place.longitude})["emergency"="shelter"];node(around:50000,${place.latitude},${place.longitude})["amenity"="shelter"];way(around:50000,${place.latitude},${place.longitude})["amenity"="shelter"];relation(around:50000,${place.latitude},${place.longitude})["amenity"="shelter"];);out center tags;`;
  let data: { elements?: { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[] };
  try {
    data = await httpJson(`${OVERPASS}?data=${encodeURIComponent(query)}`, {
      timeoutMs: 30_000,
      retries: 1,
      userAgent: 'StormReady/1.1 (community shelter lookup)',
    });
  } catch {
    throw new Error('Community shelter listings are unavailable.');
  }
  return (data.elements || []).flatMap(element => {
    const latitude = element.lat ?? element.center?.lat;
    const longitude = element.lon ?? element.center?.lon;
    if (latitude === undefined || longitude === undefined) return [];
    const tags = element.tags || {};
    const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
    return [{
      id: `osm-${element.type}-${element.id}`, name: tags.name || tags.operator || 'Shelter listing',
      address: street || tags['addr:full'] || '', city: tags['addr:city'] || tags['addr:municipality'] || '',
      phone: tags.phone || '', pets: tags.pets || '', wheelchair: tags.wheelchair || '', latitude, longitude,
      distance: distanceMiles(place.latitude, place.longitude, latitude, longitude),
    }];
  }).sort((a, b) => a.distance - b.distance);
}

export function findNearbyShelters(place: ShelterSearchPlace) {
  return place.countryCode === 'US' ? findUsShelters(place) : findMexicoShelters(place);
}
