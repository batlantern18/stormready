import type { CountryCode } from '../plan-schema';

/**
 * F09 — Seasonal readiness (pure, static data).
 *
 * The season model is a table of general guidance (R-RDY-5). The copy states
 * that local authorities determine actual conditions and dates. No network
 * lookup anywhere.
 */

export type SeasonId = 'hurricane' | 'wildfire' | 'winter';

export type SeasonDefinition = {
  id: SeasonId;
  label: string;
  /** 0-based month indices, inclusive. */
  months: number[];
  startDay: { month: number; day: number; label: string };
  authority: { label: string; url: string };
};

const HURRICANE: SeasonDefinition = {
  id: 'hurricane',
  label: 'Hurricane season',
  months: [5, 6, 7, 8, 9, 10], // June 1 – November 30
  startDay: { month: 5, day: 1, label: '1 June' },
  authority: { label: 'National Hurricane Center', url: 'https://www.nhc.noaa.gov/' },
};

const WILDFIRE: SeasonDefinition = {
  id: 'wildfire',
  label: 'Wildfire season',
  months: [3, 4, 5, 6, 7, 8, 9], // April – October
  startDay: { month: 3, day: 1, label: '1 April' },
  authority: { label: 'Ready.gov — wildfires', url: 'https://www.ready.gov/wildfires' },
};

const WINTER: SeasonDefinition = {
  id: 'winter',
  label: 'Winter storm season',
  months: [10, 11, 0, 1, 2], // November – March
  startDay: { month: 10, day: 1, label: '1 November' },
  authority: { label: 'Ready.gov — winter storms', url: 'https://www.ready.gov/winter-weather' },
};

const MX_HURRICANE: SeasonDefinition = {
  ...HURRICANE,
  label: 'Temporada de huracanes',
  authority: {
    label: 'Servicio Meteorológico Nacional (SMN)',
    url: 'https://smn.conagua.gob.mx/es/ciclones-tropicales',
  },
};

const GULF_SOUTHEAST = ['fl', 'tx', 'la', 'ms', 'al', 'ga', 'sc', 'nc', 'florida', 'texas', 'louisiana', 'mississippi', 'alabama', 'georgia', 'south carolina', 'north carolina'];
const WESTERN = ['ca', 'wa', 'or', 'nv', 'az', 'ut', 'co', 'nm', 'california', 'washington', 'oregon', 'nevada', 'arizona', 'utah', 'colorado', 'new mexico'];

function normalizeState(state: string): string {
  return state.trim().toLowerCase().replace(/^state of /, '');
}

function isKnownState(state: string): boolean {
  const normalized = normalizeState(state);
  return (
    GULF_SOUTHEAST.includes(normalized) ||
    WESTERN.includes(normalized) ||
    // Two-letter codes and full names of the northern tier resolve through the
    // winter branch; anything else (empty, unknown) has no season check.
    normalized.length === 2
  );
}

/**
 * The current season for a country/state, or null when the state is unknown
 * (an empty or unrecognized state produces no season card — honest silence).
 */
export function currentSeason(country: CountryCode, state: string, now: Date): SeasonDefinition | null {
  const month = now.getMonth();
  if (country === 'MX') return MX_HURRICANE.months.includes(month) ? MX_HURRICANE : null;

  const normalized = normalizeState(state);
  if (!state.trim() || !isKnownState(state)) return null;

  let season: SeasonDefinition;
  if (GULF_SOUTHEAST.includes(normalized)) season = HURRICANE;
  else if (WESTERN.includes(normalized)) season = WILDFIRE;
  else season = WINTER;

  return season.months.includes(month) ? season : null;
}

export type SeasonCheck = {
  season: SeasonDefinition;
};

/**
 * The season card is shown when a profile is inside a season window and its
 * kit has not been rotated since the season began (F09). Returns null when
 * there is nothing to say — the check never nags between seasons.
 */
export function seasonCheck(
  country: CountryCode,
  state: string,
  now: Date,
  lastReviewAt: string | null,
): SeasonCheck | null {
  const season = currentSeason(country, state, now);
  if (!season) return null;
  const start = new Date(now.getFullYear(), season.startDay.month, season.startDay.day);
  const startedAt = start.getTime();
  const reviewed = lastReviewAt ? new Date(lastReviewAt).getTime() : NaN;
  if (!Number.isNaN(reviewed) && reviewed >= startedAt) return null;
  return { season };
}
