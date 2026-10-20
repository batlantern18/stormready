import type { AlertSnapshot } from '../alerts';
import type { AreaPack, MapDestination } from '../area';
import { DEFAULT_REMINDER_STATE, type ReminderState } from '../notifications/types';
import { DEFAULT_PLAN, type PlanState } from '../plan-schema';
import { migratePlanFromV1 } from './migrate';

export type KeySpec<T> = {
  key: string;
  version: number;
  defaultValue: T;
  legacyKey?: string;
  parseLegacy?: (raw: string) => unknown;
  migrateLegacy?: (value: unknown) => T;
  migrate?: (value: unknown, fromVersion: number) => T;
};

export const SCHEMA_VERSION = 2;

export type ThemePreference = { dark: boolean };

export const planKey: KeySpec<PlanState> = {
  key: 'stormready.plan.v2',
  version: SCHEMA_VERSION,
  defaultValue: DEFAULT_PLAN,
  legacyKey: 'stormready.plan.v1',
  migrateLegacy: migratePlanFromV1,
  migrate: migratePlanFromV1,
};

export const themeKey: KeySpec<ThemePreference> = {
  key: 'stormready.theme.v2',
  version: 1,
  defaultValue: { dark: false },
  legacyKey: 'stormready.theme.dark.v1',
  parseLegacy: raw => raw === 'true',
  migrateLegacy: value => ({ dark: value === true }),
};

export const alertsKey: KeySpec<AlertSnapshot | null> = {
  key: 'stormready.weather-alerts.v2',
  version: 1,
  defaultValue: null,
  legacyKey: 'stormready.weather-alerts.snapshot.v1',
};

export const areaKey: KeySpec<AreaPack | null> = {
  key: 'stormready.area.v3',
  version: 2,
  defaultValue: null,
  legacyKey: 'stormready.area.v2',
};

export const destinationKey: KeySpec<MapDestination | null> = {
  key: 'stormready.map-destination.v2',
  version: 1,
  defaultValue: null,
  legacyKey: 'stormready.map-destination.v1',
};

export const notificationsKey: KeySpec<ReminderState> = {
  key: 'stormready.notifications.v1',
  version: 1,
  defaultValue: DEFAULT_REMINDER_STATE,
};

export const keys = {
  plan: planKey,
  theme: themeKey,
  alerts: alertsKey,
  area: areaKey,
  destination: destinationKey,
  notifications: notificationsKey,
} as const;
