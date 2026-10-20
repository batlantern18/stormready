import type { Shelter } from './shelters';
import type { EvacuationZone } from './zone';

export type Place = {
  label: string;
  latitude: number;
  longitude: number;
  county: string;
  region: string;
  countryCode: 'US' | 'MX';
};

export type AreaPack = Place & {
  mapPackId: string | null;
  routingGraphUri?: string;
  destinationIndexUri?: string;
  shelters: Shelter[];
  shelterCheckedAt: string | null;
  countyMapUri: string;
  evacuationZone?: EvacuationZone | null;
  zoneCheckedAt?: string | null;
  zoneLookupFailed?: boolean;
  savedAt: string;
};

export type MapDestination = { latitude: number; longitude: number };
