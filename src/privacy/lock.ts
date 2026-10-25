import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * F12b — the device-local app lock.
 *
 * R-WIP-3: the PIN lives in `expo-secure-store` (hardware-backed where
 * available), never leaves the device, is not an account, and cannot be
 * recovered if forgotten — the remedy is uninstalling the app, which also
 * deletes the data. Nothing in this module ever transmits anything.
 */

export const PIN_STORAGE_KEY = 'stormready.appPin.v1';

/** Background minutes after which the lock re-arms (R-WIP-11). */
export const LOCK_AFTER_MS = 5 * 60 * 1000;

export function pinSupported(): boolean {
  // expo-secure-store has no web implementation; the lock stays off there.
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

export async function readPin(): Promise<string | null> {
  if (!pinSupported()) return null;
  try {
    const value = await SecureStore.getItemAsync(PIN_STORAGE_KEY);
    return typeof value === 'string' && value.length ? value : null;
  } catch {
    return null;
  }
}

export async function writePin(pin: string): Promise<void> {
  if (!pinSupported()) return;
  await SecureStore.setItemAsync(PIN_STORAGE_KEY, pin);
}

export async function clearPin(): Promise<void> {
  if (!pinSupported()) return;
  await SecureStore.deleteItemAsync(PIN_STORAGE_KEY).catch(() => {});
}

export function isFourDigits(value: string): boolean {
  return /^\d{4}$/.test(value);
}

export function pinsMatch(stored: string | null, entered: string): boolean {
  return Boolean(stored) && stored === entered.trim();
}
