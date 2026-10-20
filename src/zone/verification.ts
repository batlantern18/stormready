import type { VerifiedZone, ZoneSource } from '../plan-schema';
import { LIMITS } from '../plan-schema';

export const STALE_AFTER_DAYS = 90;

export type ZoneSourceLink = { label: string; url: string; note: string };

export const OFFICIAL_ZONE_SOURCES: ZoneSourceLink[] = [
  {
    label: 'Florida Know Your Zone',
    url: 'https://www.floridadisaster.org/knowyourzone/',
    note: 'Florida Division of Emergency Management',
  },
  {
    label: 'Find your state emergency management agency',
    url: 'https://www.fema.gov/about/organization/regions',
    note: 'FEMA regional and state directory',
  },
  {
    label: 'State and local emergency information',
    url: 'https://www.ready.gov/state-local-information',
    note: 'Ready.gov',
  },
  {
    label: 'Mexico Protección Civil',
    url: 'https://www.gob.mx/proteccioncivil',
    note: 'Coordinación Nacional de Protección Civil',
  },
];

export type ManualZoneInput = {
  value: string;
  county: string;
  verifiedAt: string | null;
  notes: string;
  sourceUrl: string;
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

export function zoneSourceForRegion(region: string): ZoneSourceLink {
  const normalized = region.trim().toLowerCase();
  if (['fl', 'florida'].includes(normalized)) return OFFICIAL_ZONE_SOURCES[0];
  if (['mx', 'mexico', 'méxico'].includes(normalized)) return OFFICIAL_ZONE_SOURCES[3];
  return OFFICIAL_ZONE_SOURCES[1];
}
