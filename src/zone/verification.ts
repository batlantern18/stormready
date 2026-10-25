import type { VerifiedZone, ZoneSource } from '../plan-schema';
import { LIMITS, normalizeCountry, type CountryCode } from '../plan-schema';
import { CONFIDENCE_LABELS, providersFor, ZONE_PROVIDERS } from './registry';

export const STALE_AFTER_DAYS = 90;

export type ZoneSourceLink = { label: string; url: string; note: string };

/**
 * Generated from the zone provider registry (F12a). R-ZPR-1: there is no
 * second hand-maintained list anywhere in the app; the zone sheet, the manual
 * entry screens, and `zoneSourceForRegion` all render from this array.
 */
export const OFFICIAL_ZONE_SOURCES: ZoneSourceLink[] = ZONE_PROVIDERS.map(provider => ({
  label: provider.label,
  url: provider.authorityUrl,
  note: `${provider.authority} · ${CONFIDENCE_LABELS[provider.confidence]}`,
}));

export type ManualZoneInput = {
  value: string;
  county: string;
  verifiedAt: string | null;
  notes: string;
  sourceUrl: string;
  /** Optional country; defaults to 'US' for older callers. */
  country?: CountryCode;
};

export type ZoneValidation = {
  valid: boolean;
  errors: Partial<Record<keyof ManualZoneInput, string>>;
  value?: VerifiedZone;
};

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Validates manual evacuation-zone entry. The user is the source, so the
 * resulting zone is always marked `manual` with a verification date.
 */
export function validateManualZone(input: ManualZoneInput, now = new Date()): ZoneValidation {
  const errors: ZoneValidation['errors'] = {};
  const value = input.value.trim();
  const county = input.county.trim();
  const notes = input.notes.trim();
  const sourceUrl = input.sourceUrl.trim();

  if (!value) errors.value = 'Enter the zone or evacuation area from your local authority.';
  if (value.length > 40) errors.value = 'Keep the zone name under 40 characters.';
  if (county.length > 80) errors.county = 'Keep the county or area under 80 characters.';
  if (notes.length > LIMITS.notes) errors.notes = `Keep notes under ${LIMITS.notes} characters.`;
  if (sourceUrl && !isHttpUrl(sourceUrl)) errors.sourceUrl = 'Enter a full http or https web address.';

  let verifiedAt: string | null = null;
  if (input.verifiedAt) {
    const parsed = new Date(input.verifiedAt);
    if (Number.isNaN(parsed.getTime())) {
      errors.verifiedAt = 'Enter a valid verification date.';
    } else if (parsed.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
      errors.verifiedAt = 'The verification date cannot be in the future.';
    } else {
      verifiedAt = parsed.toISOString();
    }
  }

  if (Object.keys(errors).length) return { valid: false, errors };
  return {
    valid: true,
    errors,
    value: {
      value,
      source: 'manual',
      county,
      verifiedAt: verifiedAt ?? now.toISOString(),
      notes,
      sourceUrl,
      country: normalizeCountry(input.country),
    },
  };
}

export function zoneAgeDays(zone: VerifiedZone, now = new Date()) {
  if (!zone.verifiedAt) return null;
  const verified = new Date(zone.verifiedAt);
  if (Number.isNaN(verified.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - verified.getTime()) / (24 * 60 * 60 * 1000)));
}

export function isZoneStale(zone: VerifiedZone, now = new Date()) {
  const age = zoneAgeDays(zone, now);
  return age !== null && age > STALE_AFTER_DAYS;
}

export function zoneProvenance(source: ZoneSource) {
  switch (source) {
    case 'florida-lookup':
      return 'Checked with Florida’s official lookup';
    case 'manual':
      return 'Entered by you';
    default:
      return 'Not recorded';
  }
}

export function zoneSummary(zone: VerifiedZone, now = new Date()) {
  const stale = isZoneStale(zone, now);
  const age = zoneAgeDays(zone, now);
  return {
    stale,
    ageDays: age,
    provenance: zoneProvenance(zone.source),
    value: zone.value,
    // A zone the user typed as "Zone C" must not read as "Zone Zone C".
    label: !zone.value
      ? 'No zone recorded'
      : /^zone\b/i.test(zone.value.trim())
        ? zone.value.trim()
        : `Zone ${zone.value}`,
    warning: stale
      ? `This zone was verified ${age} days ago. Check it again with your local emergency authority.`
      : null,
  };
}

export function zoneSourceForCountryAndRegion(country: CountryCode, region?: string): ZoneSourceLink {
  const normalized = (region ?? '').trim().toLowerCase();
  const regional = ['fl', 'florida'].includes(normalized)
    ? 'fl'
    : ['mx', 'mexico', 'méxico'].includes(normalized)
      ? 'mx'
      : undefined;
  const first = providersFor(country, regional)[0] ?? OFFICIAL_ZONE_SOURCES[0];
  return {
    label: first.label,
    url: first.authorityUrl,
    note: `${first.authority} · ${CONFIDENCE_LABELS[first.confidence]}`,
  };
}

/** Kept for the 1.1 map-screen call sites (region strings, no country). */
export function zoneSourceForRegion(region: string): ZoneSourceLink {
  const normalized = region.trim().toLowerCase();
  const country: CountryCode = ['mx', 'mexico', 'méxico'].includes(normalized) ? 'MX' : 'US';
  const regional = ['fl', 'florida'].includes(normalized)
    ? 'fl'
    : ['mx', 'mexico', 'méxico'].includes(normalized)
      ? 'mx'
      : undefined;
  return zoneSourceForCountryAndRegion(country, regional);
}
