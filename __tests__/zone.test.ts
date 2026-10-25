import {
  OFFICIAL_ZONE_SOURCES,
  STALE_AFTER_DAYS,
  isZoneStale,
  validateManualZone,
  zoneAgeDays,
  zoneProvenance,
  zoneSourceForRegion,
  zoneSummary,
} from '../src/zone/verification';
import { CONFIDENCE_LABELS, ZONE_PROVIDERS, providerForCountryAndRegion, providersFor } from '../src/zone/registry';
import { DEFAULT_ZONE } from '../src/plan-schema';

const now = new Date('2026-10-19T12:00:00.000Z');

describe('validateManualZone', () => {
  it('accepts a complete manual zone and marks it as entered by the user', () => {
    const result = validateManualZone({
      value: '  Zone B ',
      county: '  Pinellas ',
      verifiedAt: '2026-10-01T00:00:00.000Z',
      notes: ' County emergency page ',
      sourceUrl: 'https://pinellas.gov/zone',
    }, now);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
    expect(result.value).toEqual({
      value: 'Zone B',
      source: 'manual',
      county: 'Pinellas',
      verifiedAt: '2026-10-01T00:00:00.000Z',
      notes: 'County emergency page',
      sourceUrl: 'https://pinellas.gov/zone',
      country: 'US',
    });
  });

  it('keeps the country the user selected (F12a/MX support)', () => {
    const result = validateManualZone({
      value: 'Zona 3', county: 'Benito Juárez', verifiedAt: null, notes: '', sourceUrl: '',
      country: 'MX',
    }, now);
    expect(result.value?.country).toBe('MX');
  });

  it('defaults the verification date to now', () => {
    const result = validateManualZone({
      value: 'A',
      county: '',
      verifiedAt: null,
      notes: '',
      sourceUrl: '',
    }, now);
    expect(result.value?.verifiedAt).toBe(now.toISOString());
  });

  it('requires a zone value', () => {
    const result = validateManualZone({ value: '   ', county: '', verifiedAt: null, notes: '', sourceUrl: '' }, now);
    expect(result.valid).toBe(false);
    expect(result.errors.value).toBeTruthy();
  });

  it('rejects overlong fields and non-web source links', () => {
    const result = validateManualZone({
      value: 'x'.repeat(41),
      county: 'x'.repeat(81),
      verifiedAt: null,
      notes: 'x'.repeat(501),
      sourceUrl: 'javascript:alert(1)',
    }, now);
    expect(result.valid).toBe(false);
    expect(result.errors.value).toBeTruthy();
    expect(result.errors.county).toBeTruthy();
    expect(result.errors.notes).toBeTruthy();
    expect(result.errors.sourceUrl).toBeTruthy();
  });

  it('accepts http source links as well as https', () => {
    expect(validateManualZone({
      value: 'A', county: '', verifiedAt: null, notes: '', sourceUrl: 'http://example.gov',
    }, now).valid).toBe(true);
  });

  it('rejects invalid and future verification dates', () => {
    const invalid = validateManualZone({ value: 'A', county: '', verifiedAt: 'not-a-date', notes: '', sourceUrl: '' }, now);
    expect(invalid.errors.verifiedAt).toBeTruthy();

    const future = validateManualZone({ value: 'A', county: '', verifiedAt: '2026-10-21T12:00:00.000Z', notes: '', sourceUrl: '' }, now);
    expect(future.errors.verifiedAt).toBeTruthy();
  });
});

describe('zone freshness', () => {
  it('counts whole days since verification', () => {
    const zone = { ...DEFAULT_ZONE, value: 'A', source: 'manual' as const, verifiedAt: '2026-10-09T12:00:00.000Z' };
    expect(zoneAgeDays(zone, now)).toBe(10);
    expect(zoneAgeDays({ ...zone, verifiedAt: null }, now)).toBeNull();
    expect(zoneAgeDays({ ...zone, verifiedAt: 'bad' }, now)).toBeNull();
  });

  it('marks zones stale only after the threshold', () => {
    const at = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const zone = { ...DEFAULT_ZONE, value: 'A', source: 'manual' as const };
    expect(isZoneStale({ ...zone, verifiedAt: at(STALE_AFTER_DAYS) }, now)).toBe(false);
    expect(isZoneStale({ ...zone, verifiedAt: at(STALE_AFTER_DAYS + 1) }, now)).toBe(true);
    expect(isZoneStale({ ...zone, verifiedAt: null }, now)).toBe(false);
  });

  it('summarizes provenance, label, and staleness warning', () => {
    const zone = {
      ...DEFAULT_ZONE,
      value: 'C',
      source: 'manual' as const,
      verifiedAt: '2026-01-01T00:00:00.000Z',
    };
    const summary = zoneSummary(zone, now);
    expect(summary).toMatchObject({ value: 'C', stale: true, provenance: 'Entered by you' });
    expect(summary.label).toBe('Zone C');
    expect(summary.warning).toContain('Check it again');

    expect(zoneSummary(DEFAULT_ZONE, now)).toMatchObject({
      value: '',
      stale: false,
      label: 'No zone recorded',
      warning: null,
    });
  });

  it('does not repeat the word zone in a label', () => {
    expect(zoneSummary({ ...DEFAULT_ZONE, value: 'Zone C' }, now).label).toBe('Zone C');
    expect(zoneSummary({ ...DEFAULT_ZONE, value: 'zone 3' }, now).label).toBe('zone 3');
    expect(zoneSummary({ ...DEFAULT_ZONE, value: 'C' }, now).label).toBe('Zone C');
  });

  it('describes where each zone came from', () => {
    expect(zoneProvenance('florida-lookup')).toContain('Florida');
    expect(zoneProvenance('manual')).toBe('Entered by you');
    expect(zoneProvenance('none')).toBe('Not recorded');
  });
});

describe('zoneSourceForRegion', () => {
  it('uses the registry (R-ZPR-1): Florida gets the state lookup', () => {
    const florida = providerForCountryAndRegion('US', 'fl');
    expect(florida?.id).toBe('florida-dem');
    expect(zoneSourceForRegion(' FL ').url).toBe(florida!.authorityUrl);
    expect(zoneSourceForRegion('Florida').url).toBe(florida!.authorityUrl);
  });

  it('uses Protección Civil for Mexico', () => {
    const mx = providersFor('MX')[0];
    expect(mx?.id).toBe('mx-proteccion-civil');
    expect(zoneSourceForRegion('MX').url).toBe(mx!.authorityUrl);
    expect(zoneSourceForRegion('México').url).toBe(mx!.authorityUrl);
  });

  it('falls back to the FEMA directory elsewhere', () => {
    const fallback = providersFor('US')[0];
    expect(fallback.confidence).toBe('manual-only');
    expect(zoneSourceForRegion('TX').url).toBe(fallback.authorityUrl);
    expect(zoneSourceForRegion('').url).toBe(fallback.authorityUrl);
  });
});

describe('zone provider registry', () => {
  it('lists regional providers before catch-alls and never duplicates', () => {
    const florida = providersFor('US', 'fl');
    expect(florida[0].id).toBe('florida-dem');
    expect(florida.map(provider => provider.id)).toHaveLength(new Set(florida.map(provider => provider.id)).size);
  });

  it('names a confidence level for every provider (R-ZPR-2)', () => {
    for (const provider of ZONE_PROVIDERS) {
      expect(Object.keys(CONFIDENCE_LABELS)).toContain(provider.confidence);
    }
    expect(CONFIDENCE_LABELS.authoritative).toContain('Official');
  });

  it('only Florida has an automated lookup; everything else is manual', () => {
    expect(providerForCountryAndRegion('US', 'tx')).toBeNull();
    expect(providerForCountryAndRegion('MX', 'cdmx')).toBeNull();
  });

  it('generates one source list from the registry', () => {
    expect(OFFICIAL_ZONE_SOURCES).toHaveLength(ZONE_PROVIDERS.length);
    expect(OFFICIAL_ZONE_SOURCES.every(source => source.label && source.url && source.note)).toBe(true);
  });
});
