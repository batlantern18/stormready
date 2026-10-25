import type { CountryCode } from '../plan-schema';
import { lookupEvacuationZone, type EvacuationZone } from '../zone';

/**
 * F12a — Zone provider registry.
 *
 * One plug-in point for automated and manual zone verification. The user never
 * sees the registry; what they see changes in two ways: every zone source list
 * in the app is generated from this file (R-ZPR-1), and each source names its
 * confidence level (R-ZPR-2). Adding a state in a future release is a data
 * change plus one lookup function, not a screen rewrite.
 */

export type ZoneLookupResult = EvacuationZone | null;

export type ZoneProviderConfidence = 'authoritative' | 'community' | 'manual-only';

export type ZoneProvider = {
  id: string;
  country: CountryCode;
  /** Region keys ('fl', 'florida', …) or ['*'] for a manual-only catch-all. */
  regions: string[];
  label: string;
  authority: string;
  authorityUrl: string;
  confidence: ZoneProviderConfidence;
  /** Omitted → presented as manual entry with the authority page linked (R-ZPR-3). */
  lookup?: (point: { latitude: number; longitude: number }) => Promise<ZoneLookupResult>;
};

export const CONFIDENCE_LABELS: Record<ZoneProviderConfidence, string> = {
  authoritative: 'Official state lookup',
  community: 'Community-mapped — verify locally',
  'manual-only': 'Enter it yourself',
};

export const ZONE_PROVIDERS: ZoneProvider[] = [
  {
    id: 'florida-dem',
    country: 'US',
    regions: ['fl', 'florida'],
    label: 'Florida Know Your Zone (DEM)',
    authority: 'Florida Division of Emergency Management',
    authorityUrl: 'https://www.floridadisaster.org/knowyourzone/',
    confidence: 'authoritative',
    // The same lookup StormReady 1.1 used. A failed lookup degrades to manual
    // entry in the calling screen; the registry only forwards the result.
    lookup: point => lookupEvacuationZone(point.latitude, point.longitude),
  },
  {
    id: 'us-fema-regions',
    country: 'US',
    regions: ['*'],
    label: 'Find your state emergency management agency',
    authority: 'FEMA regional and state directory',
    authorityUrl: 'https://www.fema.gov/about/organization/regions',
    confidence: 'manual-only',
  },
  {
    id: 'us-ready-state-local',
    country: 'US',
    regions: ['*'],
    label: 'State and local emergency information',
    authority: 'Ready.gov',
    authorityUrl: 'https://www.ready.gov/state-local-information',
    confidence: 'manual-only',
  },
  {
    id: 'mx-proteccion-civil',
    country: 'MX',
    regions: ['*'],
    label: 'Mexico Protección Civil',
    authority: 'Coordinación Nacional de Protección Civil',
    authorityUrl: 'https://www.gob.mx/proteccioncivil',
    confidence: 'manual-only',
  },
  {
    id: 'mx-cenapred',
    country: 'MX',
    regions: ['*'],
    label: 'CENAPRED risk atlas',
    authority: 'Atlas Nacional de Riesgos (CENAPRED)',
    authorityUrl: 'https://www.atlasnacionalderiesgos.gob.mx/',
    confidence: 'manual-only',
  },
];

/** Ordered providers for a country: region-matched first, catch-all after. */
export function providersFor(country: CountryCode, region?: string): ZoneProvider[] {
  const normalized = (region ?? '').trim().toLowerCase();
  const forCountry = ZONE_PROVIDERS.filter(provider => provider.country === country);
  const regional = normalized
    ? forCountry.filter(provider => provider.regions.includes(normalized) && !provider.regions.includes('*'))
    : [];
  const regionalIds = new Set(regional.map(provider => provider.id));
  const catchAll = forCountry.filter(
    provider => provider.regions.includes('*') && !regionalIds.has(provider.id),
  );
  return [...regional, ...catchAll];
}

/** The provider whose lookup covers a region, or null (manual-only region). */
export function providerForCountryAndRegion(country: CountryCode, region?: string): ZoneProvider | null {
  const regional = providersFor(country, region);
  return regional.find(provider => provider.lookup) ?? null;
}

export function providerById(id: string): ZoneProvider | null {
  return ZONE_PROVIDERS.find(provider => provider.id === id) ?? null;
}
