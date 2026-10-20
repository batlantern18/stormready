import AsyncStorage from '@react-native-async-storage/async-storage';
import { keys, planKey, themeKey } from '../src/storage/keys';
import {
  __resetStorageStateForTests,
  clearStorageIssues,
  flush,
  flushAll,
  getStorageIssues,
  load,
  remove,
  save,
  saveNow,
  subscribeStorageIssues,
} from '../src/storage/store';
import { DEFAULT_PLAN } from '../src/plan-schema';

function document(version: number, data: unknown) {
  return JSON.stringify({ version, savedAt: '2026-01-01T00:00:00.000Z', data });
}

beforeEach(async () => {
  __resetStorageStateForTests();
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('storage load', () => {
  it('returns defaults when nothing is saved', async () => {
    await expect(load(keys.plan)).resolves.toEqual(DEFAULT_PLAN);
    await expect(load(keys.theme)).resolves.toEqual({ dark: false });
  });

  it('migrates the legacy plan key and writes a versioned document', async () => {
    await AsyncStorage.setItem('stormready.plan.v1', JSON.stringify({
      household: { people: 3, days: 7, county: 'Orange' },
      zone: 'Zone C',
      tasks: [{ id: 'water', title: 'Water', done: true }],
    }));

    const plan = await load(keys.plan);
    expect(plan.onboarded).toBe(true);
    expect(plan.household.people).toBe(3);
    expect(plan.zone.value).toBe('Zone C');

    const saved = JSON.parse((await AsyncStorage.getItem(planKey.key))!);
    expect(saved.version).toBe(2);
    expect(saved.data.onboarded).toBe(true);
    expect(typeof saved.savedAt).toBe('string');
  });

  it('migrates the legacy theme string', async () => {
    await AsyncStorage.setItem('stormready.theme.dark.v1', 'true');
    await expect(load(keys.theme)).resolves.toEqual({ dark: true });
    const saved = JSON.parse((await AsyncStorage.getItem(themeKey.key))!);
    expect(saved).toMatchObject({ version: 1, data: { dark: true } });
  });

  it('migrates an older document using the schema migrate hook', async () => {
    await AsyncStorage.setItem(planKey.key, document(1, { household: { people: 5 }, zone: { value: 'A' } }));
    const plan = await load(keys.plan);
    expect(plan.household.people).toBe(5);
    expect(plan.zone.source).toBe('manual');
    const saved = JSON.parse((await AsyncStorage.getItem(planKey.key))!);
    expect(saved.version).toBe(2);
  });

  it('quarantines unreadable JSON and reports the issue', async () => {
    await AsyncStorage.setItem(planKey.key, '{oops');
    const issues: string[] = [];
    const unsubscribe = subscribeStorageIssues(snapshot => issues.push(...snapshot.map(issue => issue.kind)));

    await expect(load(keys.plan)).resolves.toEqual(DEFAULT_PLAN);
    expect(await AsyncStorage.getItem(`${planKey.key}.corrupt`)).toBe('{oops');
    expect(getStorageIssues()).toEqual([expect.objectContaining({ key: planKey.key, kind: 'corrupt' })]);
    expect(issues).toContain('corrupt');
    expect(await AsyncStorage.getItem(planKey.key)).toBe('{oops');
    unsubscribe();
  });

  it('quarantines documents with an unexpected envelope', async () => {
    await AsyncStorage.setItem(themeKey.key, JSON.stringify({ data: { dark: true } }));
    await expect(load(keys.theme)).resolves.toEqual({ dark: false });
    expect(getStorageIssues()[0]).toMatchObject({ key: themeKey.key, kind: 'corrupt' });
  });

  it('refuses to overwrite data written by a newer version', async () => {
    const newer = document(99, { theme: 'from the future' });
    await AsyncStorage.setItem(themeKey.key, newer);

    await expect(load(keys.theme)).resolves.toEqual({ dark: false });
    expect(getStorageIssues()[0]).toMatchObject({ key: themeKey.key, kind: 'newer-version' });

    save(keys.theme, { dark: true });
    await saveNow(keys.theme, { dark: true });
    await flushAll();
    expect(await AsyncStorage.getItem(themeKey.key)).toBe(newer);
  });

  it('does not duplicate repeated issues for the same key', async () => {
    await AsyncStorage.setItem(themeKey.key, '{oops');
    await load(keys.theme);
    await load(keys.theme);
    expect(getStorageIssues()).toHaveLength(1);
    clearStorageIssues();
    expect(getStorageIssues()).toHaveLength(0);
  });
});

describe('storage writes', () => {
  it('debounces writes and keeps the latest value per key', async () => {
    jest.useFakeTimers();
    save(keys.theme, { dark: true });
    save(keys.theme, { dark: false });
    expect(await AsyncStorage.getItem(themeKey.key)).toBeNull();

    jest.advanceTimersByTime(249);
    await Promise.resolve();
    expect(await AsyncStorage.getItem(themeKey.key)).toBeNull();

    jest.advanceTimersByTime(2);
    await flush(keys.theme);
    const saved = JSON.parse((await AsyncStorage.getItem(themeKey.key))!);
    expect(saved).toMatchObject({ version: 1, data: { dark: false } });
  });

  it('flushes a pending value immediately', async () => {
    save(keys.theme, { dark: true });
    await flush(keys.theme);
    const saved = JSON.parse((await AsyncStorage.getItem(themeKey.key))!);
    expect(saved.data).toEqual({ dark: true });
  });

  it('saveNow bypasses the debounce and resolves after writing', async () => {
    await saveNow(keys.theme, { dark: true });
    expect(JSON.parse((await AsyncStorage.getItem(themeKey.key))!).data).toEqual({ dark: true });
  });

  it('flushes every key', async () => {
    save(keys.theme, { dark: true });
    save(keys.notifications, { enabled: true, identifiers: { checklist: 'a' }, updatedAt: null });
    await flushAll();
    expect(JSON.parse((await AsyncStorage.getItem(themeKey.key))!).data).toEqual({ dark: true });
    expect(JSON.parse((await AsyncStorage.getItem(keys.notifications.key))!).data.enabled).toBe(true);
  });

  it('removes a stored document', async () => {
    await saveNow(keys.theme, { dark: true });
    await remove(keys.theme);
    expect(await AsyncStorage.getItem(themeKey.key)).toBeNull();
  });
});
