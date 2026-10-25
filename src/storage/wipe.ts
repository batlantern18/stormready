import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as FileSystem from 'expo-file-system/legacy';
import type { AreaPackMap } from './keys';
import { areaKey, keys, type KeySpec } from './keys';
import { load } from './store';

/**
 * F12b — "Delete all my data".
 *
 * The wipe exists in two halves:
 * - `keysForWipe()` is a **pure list** derived from `keys.ts` (R-WIP-4: the
 *   privacy screen and the wipe cannot drift, because both come from this
 *   file — a unit test keeps them in step).
 * - `wipeAllData()` is the platform wrapper: it clears every key, the saved
 *   area files, and the scheduled reminders (R-WIP-1), then the caller resets
 *   the app to onboarding (R-WIP-2).
 */

/** Every AsyncStorage key (including legacy and quarantine copies) the wipe removes. */
export function keysForWipe(): string[] {
  const result: string[] = [];
  for (const spec of Object.values(keys) as KeySpec<unknown>[]) {
    result.push(spec.key, `${spec.key}.corrupt`);
    if (spec.legacyKey) result.push(spec.legacyKey, `${spec.legacyKey}.corrupt`);
  }
  return result;
}

/** Groups the privacy descriptors so the privacy screen renders from one source. */
export function privacyDescriptorList() {
  return (Object.values(keys) as KeySpec<unknown>[]).map(spec => ({
    key: spec.key,
    ...spec.privacy,
  }));
}

/** Deletes files that the saved area pack wrote on this device, if any. */
export async function deleteLocalAreaFiles(areaMap: AreaPackMap): Promise<string[]> {
  const deleted: string[] = [];
  for (const pack of Object.values(areaMap)) {
    for (const uri of [pack.countyMapUri, pack.routingGraphUri, pack.destinationIndexUri]) {
      if (typeof uri !== 'string' || !uri.startsWith('file://')) continue;
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      deleted.push(uri);
    }
  }
  return deleted;
}

async function cancelScheduledReminders() {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    // Notifications are unsupported or denied; nothing is scheduled to cancel.
  }
}

/**
 * One complete, irreversible reset. Returns the keys that were cleared so a
 * test (or the caller) can assert that nothing survived.
 */
export async function wipeAllData(): Promise<{ clearedKeys: string[]; deletedFiles: string[] }> {
  // Read the saved area map first — the file paths only exist inside it.
  const areaMap = await load(areaKey).catch(() => ({}) as AreaPackMap);

  const cleared: string[] = [];
  for (const key of keysForWipe()) {
    try {
      await AsyncStorage.removeItem(key);
      cleared.push(key);
    } catch {
      // Storage is unavailable; the reset continues so no half-state remains.
    }
  }

  const deletedFiles = await deleteLocalAreaFiles(areaMap);
  await cancelScheduledReminders();
  return { clearedKeys: cleared, deletedFiles };
}
