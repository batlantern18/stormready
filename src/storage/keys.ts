import type { AlertSnapshot } from '../alerts';
import type { AreaPack, MapDestination } from '../area';
import type { ProfileId } from '../plan-schema';
import { DEFAULT_REMINDER_STATE, type ReminderState } from '../notifications/types';
import {
  DEFAULT_PLAN,
  DEFAULT_PROFILE_ID,
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

export const planKey: KeySpec<PlanState> = {
  key: 'stormready.plan.v3',
  version: SCHEMA_VERSION,
  defaultValue: DEFAULT_PLAN,
  legacyKey: 'stormready.plan.v2',
  parseLegacy: raw => JSON.parse(raw),
  migrateLegacy: (value, now) => migratePlanFromV2(value, now),
  migrate: (value, _fromVersion, now) => migratePlanFromV2(value, now),
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
  migrateLegacy: value => moveToProfileMap(value as AlertSnapshot | null),
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
  migrateLegacy: value => moveToProfileMap(value as AreaPack | null),
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
  migrateLegacy: value => moveToProfileMap(value as MapDestination | null),
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
