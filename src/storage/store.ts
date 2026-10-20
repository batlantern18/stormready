import AsyncStorage from '@react-native-async-storage/async-storage';
import { keys, type KeySpec } from './keys';

export type StorageIssue = {
  key: string;
  kind: 'corrupt' | 'newer-version';
  message: string;
};

type IssueListener = (issues: StorageIssue[]) => void;

const WRITE_DEBOUNCE_MS = 250;
const issues: StorageIssue[] = [];
const issueListeners = new Set<IssueListener>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const pending = new Map<string, unknown>();
const queues = new Map<string, Promise<void>>();
const blockedKeys = new Set<string>();

function notifyIssues() {
  const snapshot = [...issues];
  for (const listener of issueListeners) listener(snapshot);
}

function reportIssue(issue: StorageIssue) {
  if (issues.some(existing => existing.key === issue.key && existing.kind === issue.kind)) return;
  issues.push(issue);
  notifyIssues();
}

export function subscribeStorageIssues(listener: IssueListener) {
  issueListeners.add(listener);
  listener([...issues]);
  return () => { issueListeners.delete(listener); };
}

export function getStorageIssues() {
  return [...issues];
}

export function clearStorageIssues() {
  issues.length = 0;
  notifyIssues();
}

function cloneDefault<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function quarantine(spec: KeySpec<unknown>, raw: string, message: string) {
  await AsyncStorage.setItem(`${spec.key}.corrupt`, raw).catch(() => {});
  reportIssue({ key: spec.key, kind: 'corrupt', message });
}

function enqueue(spec: KeySpec<unknown>, task: () => Promise<void>) {
  const previous = queues.get(spec.key) ?? Promise.resolve();
  const next = previous.then(task).catch(() => {});
  queues.set(spec.key, next);
  return next;
}

async function writeNow<T>(spec: KeySpec<T>, value: T) {
  const document = JSON.stringify({
    version: spec.version,
    savedAt: new Date().toISOString(),
    data: value,
  });
  await enqueue(spec as KeySpec<unknown>, () => AsyncStorage.setItem(spec.key, document));
}

/**
 * Reads a typed document, migrating the legacy 1.0 key when present. Corrupt
 * documents are quarantined and never overwrite the stored bytes.
 */
export async function load<T>(spec: KeySpec<T>): Promise<T> {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(spec.key);
  } catch {
    reportIssue({ key: spec.key, kind: 'corrupt', message: 'Saved data could not be read. Defaults are in use.' });
    return cloneDefault(spec.defaultValue);
  }

  if (raw !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await quarantine(spec as KeySpec<unknown>, raw, 'Saved data was unreadable. Defaults are in use.');
      return cloneDefault(spec.defaultValue);
    }
    if (!isRecord(parsed) || typeof parsed.version !== 'number' || !('data' in parsed)) {
      await quarantine(spec as KeySpec<unknown>, raw, 'Saved data had an unexpected format. Defaults are in use.');
      return cloneDefault(spec.defaultValue);
    }
    if (parsed.version > spec.version) {
      // Never overwrite data written by a newer build.
      blockedKeys.add(spec.key);
      reportIssue({
        key: spec.key,
        kind: 'newer-version',
        message: 'Saved data is from a newer app version. This session will use defaults and will not overwrite it.',
      });
      return cloneDefault(spec.defaultValue);
    }
    if (parsed.version < spec.version) {
      if (!spec.migrate) return parsed.data as T;
      try {
        const migrated = spec.migrate(parsed.data, parsed.version);
        await writeNow(spec, migrated);
        return migrated;
      } catch {
        await quarantine(spec as KeySpec<unknown>, raw, 'Saved data could not be upgraded. Defaults are in use.');
        return cloneDefault(spec.defaultValue);
      }
    }
    return parsed.data as T;
  }

  if (spec.legacyKey) {
    const legacyRaw = await AsyncStorage.getItem(spec.legacyKey).catch(() => null);
    if (legacyRaw !== null) {
      try {
        const parsedLegacy = spec.parseLegacy ? spec.parseLegacy(legacyRaw) : JSON.parse(legacyRaw);
        const migrated = spec.migrateLegacy
          ? spec.migrateLegacy(parsedLegacy)
          : parsedLegacy as T;
        await writeNow(spec, migrated);
        return migrated;
      } catch {
        await quarantine(spec as KeySpec<unknown>, legacyRaw, 'Saved data from an older version could not be read. Defaults are in use.');
        return cloneDefault(spec.defaultValue);
      }
    }
  }

  return cloneDefault(spec.defaultValue);
}

/** Queues a debounced (250 ms), serialized write. */
export function save<T>(spec: KeySpec<T>, value: T) {
  if (blockedKeys.has(spec.key)) return;
  pending.set(spec.key, value);
  const existing = timers.get(spec.key);
  if (existing) clearTimeout(existing);
  timers.set(spec.key, setTimeout(() => {
    timers.delete(spec.key);
    void flush(spec);
  }, WRITE_DEBOUNCE_MS));
}

/** Writes immediately, bypassing the debounce, and waits for the write. */
export async function saveNow<T>(spec: KeySpec<T>, value: T) {
  if (blockedKeys.has(spec.key)) return;
  const timer = timers.get(spec.key);
  if (timer) clearTimeout(timer);
  timers.delete(spec.key);
  pending.delete(spec.key);
  await writeNow(spec, value);
}

/** Flushes one key's pending debounced write, if any. */
export async function flush<T>(spec: KeySpec<T>) {
  const timer = timers.get(spec.key);
  if (timer) clearTimeout(timer);
  timers.delete(spec.key);
  if (pending.has(spec.key)) {
    const value = pending.get(spec.key) as T;
    pending.delete(spec.key);
    await writeNow(spec, value);
  } else {
    await queues.get(spec.key);
  }
}

export async function flushAll() {
  for (const spec of Object.values(keys) as KeySpec<unknown>[]) {
    await flush(spec);
  }
}

export async function remove<T>(spec: KeySpec<T>) {
  const timer = timers.get(spec.key);
  if (timer) clearTimeout(timer);
  timers.delete(spec.key);
  pending.delete(spec.key);
  await enqueue(spec as KeySpec<unknown>, () => AsyncStorage.removeItem(spec.key));
}

/** Clears in-memory debounce/block state. Used by the test suite. */
export function __resetStorageStateForTests() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  pending.clear();
  queues.clear();
  blockedKeys.clear();
  issues.length = 0;
  issueListeners.clear();
}
