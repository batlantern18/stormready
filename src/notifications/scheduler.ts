import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { keys } from '../storage/keys';
import { load, saveNow } from '../storage/store';
import { configureNotificationHandler, ensureNotificationChannels, REFILLS_CHANNEL_ID, REMINDERS_CHANNEL_ID } from './channels';
import { DEFAULT_REMINDER_STATE, type ReminderState } from './types';

export type ReminderResult = {
  enabled: boolean;
  reason?: 'denied' | 'unsupported' | 'error';
  state: ReminderState;
};

/**
 * Inexact (best-effort) triggers: these are gentle planning nudges, not alarm
 * clocks, so Android may deliver them a little later than the stated time.
 */
export const REMINDER_SCHEDULE = {
  checklist: { weekday: 1, hour: 9, minute: 0 }, // Sunday at 9:00
  zone: { day: 1, hour: 10, minute: 0 }, // First of the month at 10:00
} as const;

export const REMINDER_CONTENT = {
  checklist: {
    title: 'A small step today',
    body: 'Open StormReady and finish one preparedness step.',
    data: { route: '/(tabs)/plan' },
  },
  zone: {
    title: 'Recheck your evacuation zone',
    body: 'Zones and orders can change. Verify yours with your local emergency authority.',
    data: { route: '/medical' },
  },
  refill: {
    title: 'A refill is coming up',
    body: 'A medication you added is close to its refill date. Open the medical plan to check.',
    data: { route: '/medical' },
  },
} as const;

export async function loadReminderState(): Promise<ReminderState> {
  return load(keys.notifications);
}

async function cancelIdentifiers(identifiers: ReminderState['identifiers']) {
  const ids = Object.values(identifiers).filter((id): id is string => Boolean(id));
  await Promise.allSettled(ids.map(id => Notifications.cancelScheduledNotificationAsync(id)));
}

/** Opt-in. Off by default; the caller must present the benefit before calling. */
export async function enableReminders(now = new Date()): Promise<ReminderResult> {
  if (Platform.OS === 'web') {
    return { enabled: false, reason: 'unsupported', state: DEFAULT_REMINDER_STATE };
  }
  const scheduled: string[] = [];
  try {
    configureNotificationHandler();
    await ensureNotificationChannels();
    const existingPermission = await Notifications.getPermissionsAsync();
    const permission = existingPermission.granted
      ? existingPermission
      : await Notifications.requestPermissionsAsync();
    const previous = await loadReminderState();

    if (!permission.granted) {
      const state: ReminderState = { ...previous, enabled: false };
      await saveNow(keys.notifications, state);
      return { enabled: false, reason: 'denied', state };
    }

    // Replace any prior schedule so identifiers never duplicate. The refill
    // reminder is independent: the main toggle must not cancel it (F03).
    await cancelIdentifiers({
      checklist: previous.identifiers.checklist,
      zone: previous.identifiers.zone,
    });
    const checklist = await Notifications.scheduleNotificationAsync({
      content: REMINDER_CONTENT.checklist,
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: REMINDER_SCHEDULE.checklist.weekday,
        hour: REMINDER_SCHEDULE.checklist.hour,
        minute: REMINDER_SCHEDULE.checklist.minute,
        channelId: REMINDERS_CHANNEL_ID,
        delivery: 'bestEffort',
      },
    });
    scheduled.push(checklist);
    const zone = await Notifications.scheduleNotificationAsync({
      content: REMINDER_CONTENT.zone,
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.MONTHLY,
        day: REMINDER_SCHEDULE.zone.day,
        hour: REMINDER_SCHEDULE.zone.hour,
        minute: REMINDER_SCHEDULE.zone.minute,
        channelId: REMINDERS_CHANNEL_ID,
        delivery: 'bestEffort',
      },
    });
    scheduled.push(zone);
    const state: ReminderState = {
      enabled: true,
      identifiers: { checklist, zone, rotation: previous.identifiers.rotation },
      updatedAt: now.toISOString(),
    };
    await saveNow(keys.notifications, state);
    return { enabled: true, state };
  } catch {
    // Do not leave a half-created schedule behind if the second trigger fails.
    await Promise.allSettled(scheduled.map(id => Notifications.cancelScheduledNotificationAsync(id)));
    const state: ReminderState = { enabled: false, identifiers: {}, updatedAt: now.toISOString() };
    await saveNow(keys.notifications, state).catch(() => {});
    return { enabled: false, reason: 'error', state };
  }
}

export async function disableReminders(now = new Date()): Promise<ReminderState> {
  const previous = await loadReminderState();
  // Only the checklist/zone pair belongs to this toggle; an opted-in refill
  // reminder keeps its schedule.
  await cancelIdentifiers({
    checklist: previous.identifiers.checklist,
    zone: previous.identifiers.zone,
  });
  const state: ReminderState = {
    enabled: false,
    identifiers: { rotation: previous.identifiers.rotation },
    updatedAt: now.toISOString(),
  };
  await saveNow(keys.notifications, state);
  return state;
}

/**
 * Opt-in medication refill reminder (the plan's `rotation` identifier key).
 * Turns a state change into one call: pass the earliest refill ISO date to
 * schedule a single DATE-trigger nudge on that day, or `null` to cancel it.
 * The reminder never fires for a date that has already passed.
 */
export async function setRefillReminder(earliestRefillIso: string | null, now = new Date()): Promise<ReminderState> {
  const previous = await loadReminderState();
  const withoutRotation = (): ReminderState => ({
    enabled: previous.enabled,
    identifiers: {
      checklist: previous.identifiers.checklist,
      zone: previous.identifiers.zone,
    },
    updatedAt: now.toISOString(),
  });

  if (Platform.OS === 'web') return previous;

  try {
    configureNotificationHandler();
    await ensureNotificationChannels();
    // Replacing, not stacking: an off toggle or a moved date starts clean.
    if (previous.identifiers.rotation) {
      await Notifications.cancelScheduledNotificationAsync(previous.identifiers.rotation).catch(() => {});
    }

    if (!earliestRefillIso) {
      const state = withoutRotation();
      await saveNow(keys.notifications, state);
      return state;
    }

    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) {
      const state = withoutRotation();
      await saveNow(keys.notifications, state);
      return state;
    }

    const when = refillTriggerDate(earliestRefillIso, now);
    if (!when) {
      const state = withoutRotation();
      await saveNow(keys.notifications, state);
      return state;
    }

    const identifier = await Notifications.scheduleNotificationAsync({
      content: REMINDER_CONTENT.refill,
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: when,
        channelId: REFILLS_CHANNEL_ID,
      },
    });
    const state: ReminderState = {
      enabled: previous.enabled,
      identifiers: { checklist: previous.identifiers.checklist, zone: previous.identifiers.zone, rotation: identifier },
      updatedAt: now.toISOString(),
    };
    await saveNow(keys.notifications, state);
    return state;
  } catch {
    // Never leave a scheduled nudge without a saved identifier for it.
    await cancelIdentifiers({ rotation: previous.identifiers.rotation });
    const state = withoutRotation();
    await saveNow(keys.notifications, state).catch(() => {});
    return state;
  }
}

/** YYYY-MM-DD becomes 09:00 local on that day; other ISO strings are used as-is. */
function refillTriggerDate(iso: string, now: Date): Date | null {
  const trimmed = iso.trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? new Date(`${trimmed}T09:00:00`) : new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  // Already due or overdue: the card itself carries that message, so no nudge.
  if (date.getTime() <= now.getTime()) return null;
  return date;
}
