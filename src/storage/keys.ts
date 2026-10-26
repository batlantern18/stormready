import type { AlertSnapshot } from '../alerts';
import type { AreaPack, MapDestination } from '../area';
import { DEFAULT_REMINDER_STATE, type ReminderState } from '../notifications/types';
import {
  DEFAULT_PLAN,
  DEFAULT_PROFILE_ID,
  type ProfileId,
  type PlanState,
} from '../plan-schema';
import { moveToProfileMap, migratePlanFromV2 } from './migrate';

/** Locale preference lives in the theme document (F10). */
export type LocalePreference = 'system' | 'en' | 'es';

export type KeySpec<T> = {
  key: string;
  version: number;
  defaultValue: T;
  legacyKey?: string;
  parseLegacy?: (raw: string) => unknown;
  migrateLegacy?: (value: unknown, now: string) => T;
  migrate?: (value: unknown, fromVersion: number, now: string) => T;
  /**
   * Repairs a freshly loaded document in memory before it is handed to a
   * screen. Used to un-nest per-profile values that an older build's migration
   * stored double-wrapped (the legacy envelope was migrated as the value
   * itself), so broken records self-heal without losing or rewriting the file.
   */
  normalize?(value: T): T;
  /**
   * Re-repairs a load that an earlier build migrated incorrectly: the legacy
   * envelope reached the migration as the value, so defaults were written over
   * real data and the current document now matches the current version (no
   * migration will run again). Receives the parsed legacy payload (envelope
   * already unwrapped) when the legacy document still exists; returns a
   * repaired value or the value unchanged.
   */
  repairFromLegacy?(value: T, legacy: unknown, now: string): T;
  /**
   * v1.2 (F12): drives the privacy screen. A unit test fails if a key is
   * added without one (R-WIP-0), so the privacy list cannot under-report.
   */
  privacy: {
    title: string;
    description: string;
    sensitive?: boolean;
  };
};

export const SCHEMA_VERSION = 3;

export type ThemePreference = { dark: boolean; locale: LocalePreference };

export function normalizeLocale(value: unknown): LocalePreference {
  return value === 'en' || value === 'es' ? value : 'system';
}

export type AlertSnapshotMap = Record<ProfileId, AlertSnapshot>;
export type AreaPackMap = Record<ProfileId, AreaPack>;
export type DestinationMap = Record<ProfileId, MapDestination>;

function isStorageEnvelope(value: unknown): value is { data: unknown } {
  return typeof value === 'object' && value !== null
    && !Array.isArray(value)
    && typeof (value as { version?: unknown }).version === 'number'
    && 'data' in value;
}

/**
 * Older migrations handed the whole legacy document — including its
 * `{version, savedAt, data}` envelope — into `moveToProfileMap`, so each
 * profile's value was stored as an envelope again. Unwrap such values.
 */
function healProfileMap<T>(map: Record<ProfileId, T>): Record<ProfileId, T> {
  if (!map || typeof map !== 'object') return map;
  const healed: Record<string, T> = {};
  let changed = false;
  for (const [profile, value] of Object.entries(map)) {
    if (isStorageEnvelope(value)) {
      healed[profile] = value.data as T;
      changed = true;
    } else healed[profile] = value;
  }
  return changed ? healed as Record<ProfileId, T> : map;
}

export const planKey: KeySpec<PlanState> = {
  key: 'stormready.plan.v3',
  version: SCHEMA_VERSION,
  defaultValue: DEFAULT_PLAN,
  legacyKey: 'stormready.plan.v2',
  parseLegacy: raw => JSON.parse(raw),
  migrateLegacy: (value, now) => migratePlanFromV2(value, now),
  migrate: (value, _fromVersion, now) => migratePlanFromV2(value, now),
  /**
   * v1.2 repair: the first release that wrote plan.v3 fed the legacy storage
   * envelope into the migration as if it were the plan, so a default plan may
   * have been recorded over real v2 data (the wipe). While an untouched legacy
   * plan survives, refill the fields the wipe blanked — destination, zone, and
   * household — for profiles that still hold the wiped defaults. Newer user
   * edits anywhere else in the plan are kept.
   */
  repairFromLegacy: (value, legacy, now) => {
    if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return value;
    const restored = migratePlanFromV2(legacy, now);
    const fallback = restored.profiles[DEFAULT_PROFILE_ID];
    if (!fallback) return value;
    const legacyWorthkeeping = fallback.destination.address !== '' || fallback.zone.value !== '' || fallback.zone.verifiedAt !== null || fallback.household.county !== '';
    if (!legacyWorthkeeping) return value;
    let changed = false;
    const profiles = { ...value.profiles };
    for (const [profileId, profile] of Object.entries(value.profiles)) {
      const wiped = profile.household.county === '' && profile.destination.address === '' && profile.zone.value === '' && profile.zone.verifiedAt === null;
      if (!wiped) continue;
      profiles[profileId as ProfileId] = {
        ...profile,
        household: fallback.household,
        zone: fallback.zone,
        destination: fallback.destination,
      };
      changed = true;
    }
    // The wipe also stranded some devices on first-run onboarding: its save
    // could record onboarded:false. A user who completed onboarding never has
    // it false here with a meaningful legacy plan, so adopt the legacy flag.
    if (value.onboarded !== restored.onboarded) changed = true;
    return changed ? { ...value, onboarded: restored.onboarded, profiles, updatedAt: now } : value;
  },
  privacy: {
    title: 'My plan and checklist',
    description: 'Your household details, kit checklist, zone record, destination, contacts, medical plan, go-bags, inventory, and drill history.',
    sensitive: true,
  },
};

export const themeKey: KeySpec<ThemePreference> = {
  key: 'stormready.theme.v2',
  version: 1,
  defaultValue: { dark: false, locale: 'system' },
  legacyKey: 'stormready.theme.dark.v1',
  parseLegacy: raw => raw === 'true',
  migrateLegacy: value => ({ dark: value === true, locale: 'system' }),
  migrate: value => ({
    dark: (value as { dark?: unknown }).dark === true,
    locale: normalizeLocale((value as { locale?: unknown }).locale),
  }),
  privacy: {
    title: 'Appearance settings',
    description: 'Your light/dark mode choice and language preference.',
  },
};

export const alertsKey: KeySpec<AlertSnapshotMap> = {
  key: 'stormready.weather-alerts.v3',
  version: 1,
  defaultValue: {},
  legacyKey: 'stormready.weather-alerts.v2',
  parseLegacy: raw => JSON.parse(raw),
  migrateLegacy: value => moveToProfileMap(value as AlertSnapshot | null),
  normalize: value => healProfileMap(value) as AlertSnapshotMap,
  privacy: {
    title: 'Checked weather-alert copy',
    description: 'The alert snapshot from your last check, including the roughly rounded point it was checked for, so you can read it offline.',
    sensitive: true,
  },
};

export const areaKey: KeySpec<AreaPackMap> = {
  key: 'stormready.area.v4',
  version: 2,
  defaultValue: {},
  legacyKey: 'stormready.area.v3',
  parseLegacy: raw => JSON.parse(raw),
  migrateLegacy: value => moveToProfileMap(value as AreaPack | null),
  normalize: value => healProfileMap(value) as AreaPackMap,
  privacy: {
    title: 'Your saved map area',
    description: 'The offline map region you saved, its center point, and the shelters and zone detail cached for it.',
    sensitive: true,
  },
};

export const destinationKey: KeySpec<DestinationMap> = {
  key: 'stormready.map-destination.v3',
  version: 1,
  defaultValue: {},
  legacyKey: 'stormready.map-destination.v2',
  parseLegacy: raw => JSON.parse(raw),
  migrateLegacy: value => moveToProfileMap(value as MapDestination | null),
  normalize: value => healProfileMap(value) as DestinationMap,
  privacy: {
    title: 'Pin on the map',
    description: 'The point you last pinned as your destination.',
    sensitive: true,
  },
};

export const notificationsKey: KeySpec<ReminderState> = {
  key: 'stormready.notifications.v1',
  version: 1,
  defaultValue: DEFAULT_REMINDER_STATE,
  privacy: {
    title: 'Reminder settings',
    description: 'Whether local (opt-in) reminders are scheduled, and the identifiers needed to cancel them.',
  },
};

export const keys = {
  plan: planKey,
  theme: themeKey,
  alerts: alertsKey,
  area: areaKey,
  destination: destinationKey,
  notifications: notificationsKey,
} as const;

/** The profile id the migration places single-profile data under. */
export const LEGACY_PROFILE_ID = DEFAULT_PROFILE_ID;
