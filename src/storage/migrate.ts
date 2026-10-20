import {
  DEFAULT_HOUSEHOLD,
  DEFAULT_PLAN,
  DEFAULT_TASKS,
  LIMITS,
  clampHousehold,
  type Destination,
  type Household,
  type PlanState,
  type Task,
  type VerifiedZone,
  type ZoneSource,
} from '../plan-schema';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function zoneSource(value: unknown, hasValue: boolean): ZoneSource {
  if (value === 'florida-lookup' || value === 'manual' || value === 'none') return value;
  return hasValue ? 'manual' : 'none';
}

function normalizeZone(raw: unknown, legacyCounty: string): VerifiedZone {
  const source = record(raw);
  if (source) {
    const value = text(source.value).trim();
    const hasValue = Boolean(value);
    return {
      value,
      source: hasValue ? zoneSource(source.source, true) : 'none',
      county: text(source.county, legacyCounty).trim(),
      verifiedAt: isoDate(source.verifiedAt),
      notes: text(source.notes).slice(0, LIMITS.notes),
      sourceUrl: text(source.sourceUrl).trim(),
    };
  }

  // StormReady 1.0 stored the zone as a plain string. The original source was
  // not recorded, so label it as unverified rather than claiming a lookup.
  const value = text(raw).trim();
  if (!value) {
    return {
      value: '',
      source: 'none',
      county: legacyCounty,
      verifiedAt: null,
      notes: '',
      sourceUrl: '',
    };
  }
  return {
    value,
    source: 'manual',
    county: legacyCounty,
    verifiedAt: null,
    notes: 'Imported from StormReady 1.0. Verify the source with your local emergency authority.',
    sourceUrl: '',
  };
}

function normalizeHousehold(raw: unknown): Household {
  const source = record(raw) ?? {};
  const pets = bool(source.pets, DEFAULT_HOUSEHOLD.pets);
  return clampHousehold({
    people: Number(source.people ?? DEFAULT_HOUSEHOLD.people),
    infants: Number(source.infants ?? DEFAULT_HOUSEHOLD.infants),
    days: Number(source.days ?? DEFAULT_HOUSEHOLD.days),
    pets,
    petCount: Number(source.petCount ?? (pets ? 1 : 0)),
    hasVehicle: bool(source.hasVehicle, DEFAULT_HOUSEHOLD.hasVehicle),
    medicalNeeds: bool(source.medicalNeeds, DEFAULT_HOUSEHOLD.medicalNeeds),
    county: text(source.county, DEFAULT_HOUSEHOLD.county),
    accessibilityNeeds: bool(source.accessibilityNeeds, DEFAULT_HOUSEHOLD.accessibilityNeeds),
  });
}

function normalizeTasks(raw: unknown): Task[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_TASKS;
  const tasks = raw.flatMap((item): Task[] => {
    const source = record(item);
    if (!source || typeof source.id !== 'string') return [];
    return [{
      id: source.id,
      title: text(source.title, 'Preparedness step'),
      detail: text(source.detail),
      category: text(source.category, 'Plan'),
      done: bool(source.done, false),
      optional: typeof source.optional === 'boolean' ? source.optional : undefined,
    }];
  });
  return tasks.length ? tasks : DEFAULT_TASKS;
}

function normalizeDestination(raw: unknown): Destination {
  const source = record(raw) ?? {};
  return {
    label: text(source.label),
    address: text(source.address),
    transport: text(source.transport),
  };
}

/**
 * Migrates the StormReady 1.0 plan document (or an older v2 document) into the
 * v2 schema. Unknown fields are ignored and invalid values fall back safely.
 */
export function migratePlanFromV1(raw: unknown): PlanState {
  const source = record(raw);
  if (!source) return DEFAULT_PLAN;
  const household = normalizeHousehold(source.household);
  return {
    // Anyone with a saved 1.0 plan has already used the app and must not be
    // sent through first-run onboarding.
    onboarded: bool(source.onboarded, true),
    household,
    zone: normalizeZone(source.zone ?? record(source.household)?.zone, household.county),
    destination: normalizeDestination(source.destination),
    tasks: normalizeTasks(source.tasks),
  };
}
