import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { __resetStorageStateForTests } from '../src/storage/store';
import { keys } from '../src/storage/keys';
import { DEFAULT_REMINDER_STATE } from '../src/notifications/types';
import {
  REMINDER_CONTENT,
  REMINDER_SCHEDULE,
  disableReminders,
  enableReminders,
  loadReminderState,
  setRefillReminder,
} from '../src/notifications/scheduler';

jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { WEEKLY: 'weekly', MONTHLY: 'monthly', DATE: 'date' },
  AndroidImportance: { LOW: 4, DEFAULT: 5 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
}));

const mocked = Notifications as jest.Mocked<typeof Notifications>;
const originalPlatform = Platform.OS;

beforeEach(async () => {
  __resetStorageStateForTests();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  (Platform as { OS: string }).OS = originalPlatform;
  mocked.getPermissionsAsync.mockResolvedValue({ granted: true } as never);
  mocked.requestPermissionsAsync.mockResolvedValue({ granted: true } as never);
  mocked.scheduleNotificationAsync
    .mockResolvedValueOnce('checklist-id')
    .mockResolvedValueOnce('zone-id');
});

afterAll(() => {
  (Platform as { OS: string }).OS = originalPlatform;
});

describe('loadReminderState', () => {
  it('is opt-out by default', async () => {
    await expect(loadReminderState()).resolves.toEqual(DEFAULT_REMINDER_STATE);
  });
});

describe('enableReminders', () => {
  it('schedules both weekly and monthly reminders and saves their identifiers', async () => {
    const now = new Date('2026-10-19T12:00:00.000Z');
    const result = await enableReminders(now);

    expect(result.enabled).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.state).toEqual({
      enabled: true,
      identifiers: { checklist: 'checklist-id', zone: 'zone-id' },
      updatedAt: now.toISOString(),
    });

    expect(mocked.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(mocked.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
    expect(mocked.scheduleNotificationAsync).toHaveBeenNthCalledWith(1, {
      content: REMINDER_CONTENT.checklist,
      trigger: expect.objectContaining({
        type: 'weekly',
        weekday: REMINDER_SCHEDULE.checklist.weekday,
        hour: REMINDER_SCHEDULE.checklist.hour,
        minute: REMINDER_SCHEDULE.checklist.minute,
        channelId: 'reminders',
        delivery: 'bestEffort',
      }),
    });
    expect(mocked.scheduleNotificationAsync).toHaveBeenNthCalledWith(2, {
      content: REMINDER_CONTENT.zone,
      trigger: expect.objectContaining({
        type: 'monthly',
        day: REMINDER_SCHEDULE.zone.day,
        hour: REMINDER_SCHEDULE.zone.hour,
        minute: REMINDER_SCHEDULE.zone.minute,
        channelId: 'reminders',
        delivery: 'bestEffort',
      }),
    });

    await expect(loadReminderState()).resolves.toMatchObject({
      enabled: true,
      identifiers: { checklist: 'checklist-id', zone: 'zone-id' },
    });
  });

  it('asks for permission when it has not been granted', async () => {
    mocked.getPermissionsAsync.mockResolvedValueOnce({ granted: false } as never);
    const result = await enableReminders();
    expect(mocked.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(result.enabled).toBe(true);
  });

  it('cancels a previous schedule before replacing it', async () => {
    await AsyncStorage.setItem(keys.notifications.key, JSON.stringify({
      version: 1,
      savedAt: '2026-01-01T00:00:00.000Z',
      data: { enabled: true, identifiers: { checklist: 'old-a', zone: 'old-b' }, updatedAt: null },
    }));

    await enableReminders();
    expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith('old-a');
    expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith('old-b');
  });

  it('reports denied permission and leaves reminders off', async () => {
    mocked.getPermissionsAsync.mockResolvedValueOnce({ granted: false } as never);
    mocked.requestPermissionsAsync.mockResolvedValueOnce({ granted: false } as never);

    const result = await enableReminders();
    expect(result).toMatchObject({ enabled: false, reason: 'denied' });
    expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();
    await expect(loadReminderState()).resolves.toMatchObject({ enabled: false });
  });

  it('reports a scheduling failure without claiming success', async () => {
    mocked.scheduleNotificationAsync.mockReset();
    mocked.scheduleNotificationAsync.mockRejectedValueOnce(new Error('boom'));

    const result = await enableReminders();
    expect(result).toMatchObject({ enabled: false, reason: 'error', state: { enabled: false, identifiers: {} } });
    await expect(loadReminderState()).resolves.toMatchObject({ enabled: false, identifiers: {} });
  });

  it('cancels a partial schedule when the second trigger fails', async () => {
    mocked.scheduleNotificationAsync.mockReset();
    mocked.scheduleNotificationAsync
      .mockResolvedValueOnce('half-created')
      .mockRejectedValueOnce(new Error('boom'));

    const result = await enableReminders();
    expect(result).toMatchObject({ enabled: false, reason: 'error', state: { identifiers: {} } });
    expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith('half-created');
  });

  it('is unsupported on web without prompting', async () => {
    (Platform as { OS: string }).OS = 'web';
    const result = await enableReminders();
    expect(result).toMatchObject({ enabled: false, reason: 'unsupported' });
    expect(mocked.getPermissionsAsync).not.toHaveBeenCalled();
    expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('disableReminders', () => {
  it('cancels saved identifiers and clears local state', async () => {
    await AsyncStorage.setItem(keys.notifications.key, JSON.stringify({
      version: 1,
      savedAt: '2026-01-01T00:00:00.000Z',
      data: { enabled: true, identifiers: { checklist: 'a', zone: 'b' }, updatedAt: null },
    }));

    const state = await disableReminders(new Date('2026-10-19T12:00:00.000Z'));
    expect(state).toEqual({ enabled: false, identifiers: {}, updatedAt: '2026-10-19T12:00:00.000Z' });
    expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith('a');
    expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith('b');
    await expect(loadReminderState()).resolves.toEqual(state);
  });
});

/** Seeds the reminder document, optionally with an opted-in refill identifier. */
async function seedReminders(identifierState: Record<string, unknown> = { checklist: 'c', zone: 'z' }) {
  await AsyncStorage.setItem(keys.notifications.key, JSON.stringify({
    version: 1,
    savedAt: '2026-01-01T00:00:00.000Z',
    data: { enabled: true, identifiers: identifierState, updatedAt: '2026-01-01T00:00:00.000Z' },
  }));
}

describe('setRefillReminder (F03)', () => {
  const now = new Date('2026-10-20T12:00:00.000Z');

  it('schedules one DATE-trigger nudge on the refill morning via the refills channel', async () => {
    await seedReminders();
    mocked.scheduleNotificationAsync.mockReset().mockResolvedValueOnce('rotation-id');

    const state = await setRefillReminder('2026-11-05', now);

    expect(state.identifiers).toEqual({ checklist: 'c', zone: 'z', rotation: 'rotation-id' });
    expect(mocked.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: REMINDER_CONTENT.refill,
      trigger: {
        type: 'date',
        date: new Date('2026-11-05T09:00:00'),
        channelId: 'refills',
      },
    });
  });

  it('cancels a previous schedule before replacing it', async () => {
    await seedReminders({ checklist: 'c', zone: 'z', rotation: 'old-refill' });
    mocked.scheduleNotificationAsync.mockReset().mockResolvedValueOnce('rotation-id');

    await setRefillReminder('2026-11-20', now);

    expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith('old-refill');
  });

  it('never fires for a date that has already passed or is invalid', async () => {
    await seedReminders({ checklist: 'c', zone: 'z', rotation: 'old-refill' });

    const stale = await setRefillReminder('2026-01-01', now);
    expect(stale.identifiers).toEqual({ checklist: 'c', zone: 'z' });
    expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();

    const unparseable = await setRefillReminder('not-a-date', now);
    expect(unparseable.identifiers.rotation).toBeUndefined();
    await expect(loadReminderState()).resolves.toMatchObject({ identifiers: { checklist: 'c', zone: 'z' } });
  });

  it('turns the reminder off while keeping the independent checklist/zone pair', async () => {
    await seedReminders({ checklist: 'c', zone: 'z', rotation: 'old-refill' });
    mocked.scheduleNotificationAsync.mockReset().mockResolvedValueOnce('rotation-id');
    await setRefillReminder('2026-11-05', now);

    const state = await setRefillReminder(null, now);

    expect(state.identifiers).toEqual({ checklist: 'c', zone: 'z' });
    expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith('old-refill');
    // A second call with nothing left to cancel must not throw.
    await expect(setRefillReminder(null, now)).resolves.toMatchObject({ identifiers: { checklist: 'c', zone: 'z' } });
  });

  it('keeps the reminders toggled off when permission is denied', async () => {
    await seedReminders({ checklist: 'c', zone: 'z' });
    mocked.getPermissionsAsync.mockResolvedValueOnce({ granted: false } as never);
    mocked.scheduleNotificationAsync.mockReset().mockResolvedValueOnce('rotation-id');

    const state = await setRefillReminder('2026-11-05', now);

    expect(state.identifiers.rotation).toBeUndefined();
    expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('cleans up on an unexpected failure so no orphan schedule keeps running', async () => {
    await seedReminders({ checklist: 'c', zone: 'z', rotation: 'old-refill' });
    mocked.scheduleNotificationAsync.mockReset().mockRejectedValueOnce(new Error('boom'));

    const state = await setRefillReminder('2026-11-05', now);

    expect(state.identifiers.rotation).toBeUndefined();
    expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith('old-refill');
    await expect(loadReminderState()).resolves.toMatchObject({ identifiers: { checklist: 'c', zone: 'z' } });
  });

  it('does nothing on web', async () => {
    (Platform as { OS: string }).OS = 'web';
    await seedReminders({ checklist: 'c', zone: 'z' });

    const state = await setRefillReminder('2026-11-05', now);

    expect(state.identifiers).toEqual({ checklist: 'c', zone: 'z' });
    expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('reminder independence', () => {
  it('keeps the refill identifier through enable and disable (F03)', async () => {
    await seedReminders({ checklist: 'c', zone: 'z', rotation: 'rotation-id' });

    const enabled = await enableReminders(new Date('2026-10-20T12:00:00.000Z'));
    expect(enabled.state.identifiers).toMatchObject({ rotation: 'rotation-id' });

    const disabled = await disableReminders();
    expect(disabled.identifiers).toMatchObject({ rotation: 'rotation-id' });
  });
});
