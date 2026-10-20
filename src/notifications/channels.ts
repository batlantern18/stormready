import { AndroidImportance, setNotificationChannelAsync, setNotificationHandler } from 'expo-notifications';
import { Platform } from 'react-native';

export const REMINDERS_CHANNEL_ID = 'reminders';
export const ALERTS_CHANNEL_ID = 'alerts';

/**
 * Android requires a channel before the permission prompt appears. Reminders
 * use a low-importance channel so they never feel like emergency alerts; the
 * `alerts` channel is reserved for future time-sensitive messages.
 */
export async function ensureNotificationChannels() {
  if (Platform.OS !== 'android') return;
  await setNotificationChannelAsync(REMINDERS_CHANNEL_ID, {
    name: 'Plan reminders',
    description: 'Optional nudges to work on your preparedness checklist and recheck your zone.',
    importance: AndroidImportance.LOW,
    sound: null,
    enableVibrate: false,
    showBadge: false,
  });
  await setNotificationChannelAsync(ALERTS_CHANNEL_ID, {
    name: 'Emergency alerts',
    description: 'Reserved for time-sensitive safety messages. StormReady v1.1 does not schedule any alerts.',
    importance: AndroidImportance.DEFAULT,
    sound: 'default',
    showBadge: true,
  });
}

export function configureNotificationHandler() {
  if (Platform.OS === 'web') return;
  try {
    setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // Notifications are optional; a failure here must never block the app.
  }
}
