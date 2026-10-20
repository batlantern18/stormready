import { httpJson } from './net/http';

const FLORIDA_EVACUATION_ZONES = 'https://services.arcgis.com/3wFbqsFPLeKqOlIK/ArcGIS/rest/services/KYZ_ZL_Vector_Enriched_Calculated_20230608/FeatureServer/46/query';

export type EvacuationZone = { zone: string; county: string; status: string };

/** Looks up an address point against Florida Division of Emergency Management evacuation polygons. */
export async function lookupEvacuationZone(latitude: number, longitude: number): Promise<EvacuationZone | null> {
  const params = new URLSearchParams({
    geometry: `${longitude},${latitude}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'EZone,County_Nam,STATUS',
    returnGeometry: 'false',
    f: 'json',
  });
  let data: {
    error?: { message?: string };
    features?: { attributes?: { EZone?: string; County_Nam?: string; STATUS?: string } }[];
  };
  try {
    data = await httpJson(`${FLORIDA_EVACUATION_ZONES}?${params.toString()}`, {
      timeoutMs: 20_000,
      userAgent: 'StormReady/1.1 (Florida zone lookup)',
    });
  } catch {
    throw new Error('Florida evacuation zone lookup is unavailable.');
  }
  if (data.error) throw new Error(data.error.message || 'Florida evacuation zone lookup failed.');
  const attributes = data.features?.[0]?.attributes;
  if (!attributes?.EZone?.trim()) return null;
  return {
    zone: attributes.EZone.trim(),
    county: attributes.County_Nam?.trim() || '',
    status: attributes.STATUS?.trim() || '',
  };
}
