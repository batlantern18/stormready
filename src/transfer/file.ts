import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { PlanEnvelope } from './model';
import { parseEnvelope } from './model';

/**
 * F06 — the platform half of plan transfer. It is a thin wrapper (plan §8.1):
 * the file itself is plain JSON moved by the user's own share sheet or document
 * picker, and no network request is ever made (R-EXP-7).
 */

const FILE_PREFIX = 'stormready-plan-';

/** Writes the envelope to a temp file and opens the system share sheet. */
export async function shareEnvelope(envelope: PlanEnvelope): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  const stamp = envelope.exportedAt.replace(/[:.]/g, '-').slice(0, 19);
  const uri = `${FileSystem.cacheDirectory}${FILE_PREFIX}${stamp}.stormready-plan`;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(envelope, null, 2), {
    encoding: FileSystem.EncodingType.UTF8,
  });
  await Sharing.shareAsync(uri, {
    mimeType: 'application/json',
    dialogTitle: 'StormReady plan',
    UTI: 'public.json',
  });
  return true;
}

export type PickedPlan =
  | { ok: true; envelope: PlanEnvelope }
  | { ok: false; reason: string }
  | { ok: 'cancelled' };

/** Opens the document picker and reads the chosen file into an envelope. */
export async function pickPlanFile(): Promise<PickedPlan> {
  const picked = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
  }).catch(() => null);
  if (!picked || picked.canceled) return { ok: 'cancelled' };
  const asset = picked.assets[0];
  if (!asset?.uri) return { ok: false, reason: 'That file could not be opened.' };
  try {
    const raw = await FileSystem.readAsStringAsync(asset.uri);
    return parseEnvelope(JSON.parse(raw));
  } catch {
    return { ok: false, reason: 'That file is not a readable StormReady plan.' };
  }
}

/** Test seam: deletes exported temp files (the wipe removes the cache anyway). */
export async function deleteExportFile(uri: string): Promise<void> {
  await FileSystem.deleteAsync(uri, { idempotent: true });
}
