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
import { DEFAULT_HOUSEHOLD, DEFAULT_PLAN, DEFAULT_PROFILE_ID, DEFAULT_TASKS } from '../src/plan-schema';

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
    await expect(load(keys.theme)).resolves.toEqual({ dark: false, locale: 'system' });
    await expect(load(keys.alerts)).resolves.toEqual({});
    await expect(load(keys.area)).resolves.toEqual({});
  });

  it('migrates the legacy v2 plan key into the v3 single-profile layout', async () => {
    await AsyncStorage.setItem(planKey.legacyKey!, JSON.stringify({
      onboarded: true,
      household: { people: 3, days: 7, county: 'Orange' },
      zone: 'Zone C',
      tasks: [{ id: 'water', title: 'Water', done: true }],
    }));

    const plan = await load(keys.plan);
    expect(plan.onboarded).toBe(true);
    expect(plan.activeProfileId).toBe(DEFAULT_PROFILE_ID);
    expect(plan.profiles.default.household.people).toBe(3);
    expect(plan.profiles.default.zone.value).toBe('Zone C');
    expect(plan.profiles.default.tasks[0]).toMatchObject({ id: 'water', done: true });
    expect(plan.profiles.default.inventory).toEqual({ entries: {}, lastRotationAt: null });
    expect(plan.profiles.default.goBags).toEqual({ bags: [] });
    expect(plan.profiles.default.drills).toEqual({ results: [] });

    const saved = JSON.parse((await AsyncStorage.getItem(planKey.key))!);
    expect(saved.version).toBe(3);
    expect(saved.data.profiles.default.household.people).toBe(3);
    expect(saved.savedAt).toBeTruthy();
  });

  it('maps legacy single-value keys into per-profile maps', async () => {
    const snapshot = { alerts: [], point: { latitude: 27.9, longitude: -82.4 }, checked: 'now', countryCode: 'US' };
    await AsyncStorage.setItem(keys.alerts.legacyKey!, JSON.stringify(snapshot));

    const alerts = await load(keys.alerts);
    expect(alerts).toEqual({ [DEFAULT_PROFILE_ID]: snapshot });

    const saved = JSON.parse((await AsyncStorage.getItem(keys.alerts.key))!);
    expect(saved.version).toBe(1);
    expect(saved.data.default.countryCode).toBe('US');
  });

  it('migrates the legacy theme string and adds the locale field', async () => {
    await AsyncStorage.setItem(themeKey.legacyKey!, 'true');
    await expect(load(keys.theme)).resolves.toEqual({ dark: true, locale: 'system' });
    const saved = JSON.parse((await AsyncStorage.getItem(themeKey.key))!);
    expect(saved).toMatchObject({ version: 1, data: { dark: true, locale: 'system' } });
  });

  it('upgrades an older plan document through the schema migrate hook', async () => {
    await AsyncStorage.setItem(planKey.key, document(2, { onboarded: true, household: { people: 5 }, zone: { value: 'A' } }));
    const plan = await load(keys.plan);
    expect(plan.profiles.default.household.people).toBe(5);
    expect(plan.profiles.default.household.country).toBe('US');
    expect(plan.profiles.default.zone.source).toBe('manual');
    const saved = JSON.parse((await AsyncStorage.getItem(planKey.key))!);
    expect(saved.version).toBe(3);
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

  it('quarantines legacy documents that cannot be upgraded', async () => {
    await AsyncStorage.setItem(planKey.legacyKey!, 'not json at all');
    await expect(load(keys.plan)).resolves.toEqual(DEFAULT_PLAN);
    expect(getStorageIssues()[0]).toMatchObject({ key: planKey.key, kind: 'corrupt' });
  });

  it('quarantines documents with an unexpected envelope', async () => {
    await AsyncStorage.setItem(themeKey.key, JSON.stringify({ data: { dark: true } }));
    await expect(load(keys.theme)).resolves.toEqual({ dark: false, locale: 'system' });
    expect(getStorageIssues()[0]).toMatchObject({ key: themeKey.key, kind: 'corrupt' });
  });

  it('refuses to overwrite data written by a newer version', async () => {
    const newer = document(99, { theme: 'from the future' });
    await AsyncStorage.setItem(themeKey.key, newer);

    await expect(load(keys.theme)).resolves.toEqual({ dark: false, locale: 'system' });
    expect(getStorageIssues()[0]).toMatchObject({ key: themeKey.key, kind: 'newer-version' });

    save(keys.theme, { dark: true, locale: 'en' });
    await saveNow(keys.theme, { dark: true, locale: 'en' });
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
    save(keys.theme, { dark: true, locale: 'en' });
    save(keys.theme, { dark: false, locale: 'system' });
    expect(await AsyncStorage.getItem(themeKey.key)).toBeNull();

    jest.advanceTimersByTime(249);
    await Promise.resolve();
    expect(await AsyncStorage.getItem(themeKey.key)).toBeNull();

    jest.advanceTimersByTime(2);
    await flush(keys.theme);
    const saved = JSON.parse((await AsyncStorage.getItem(themeKey.key))!);
    expect(saved).toMatchObject({ version: 1, data: { dark: false, locale: 'system' } });
  });

  it('flushes a pending value immediately', async () => {
    save(keys.theme, { dark: true, locale: 'en' });
    await flush(keys.theme);
    const saved = JSON.parse((await AsyncStorage.getItem(themeKey.key))!);
    expect(saved.data).toEqual({ dark: true, locale: 'en' });
  });

  it('saveNow bypasses the debounce and resolves after writing', async () => {
    await saveNow(keys.theme, { dark: true, locale: 'es' });
    expect(JSON.parse((await AsyncStorage.getItem(themeKey.key))!).data).toEqual({ dark: true, locale: 'es' });
  });

  it('flushes every key', async () => {
    save(keys.theme, { dark: true, locale: 'en' });
    save(keys.notifications, { enabled: true, identifiers: { checklist: 'a' }, updatedAt: null });
    save(keys.alerts, { default: { alerts: [], point: { latitude: 0, longitude: 0 }, checked: '', countryCode: 'US' } });
    await flushAll();
    expect(JSON.parse((await AsyncStorage.getItem(themeKey.key))!).data).toEqual({ dark: true, locale: 'en' });
    expect(JSON.parse((await AsyncStorage.getItem(keys.notifications.key))!).data.enabled).toBe(true);
    expect(JSON.parse((await AsyncStorage.getItem(keys.alerts.key))!).data.default).toEqual({
      alerts: [], point: { latitude: 0, longitude: 0 }, checked: '', countryCode: 'US',
    });
  });

  it('writes a versioned plan document with the whole v3 envelope', async () => {
    await saveNow(keys.plan, {
      ...DEFAULT_PLAN,
      onboarded: true,
      updatedAt: '2026-10-19T00:00:00.000Z',
    });
    const saved = JSON.parse((await AsyncStorage.getItem(planKey.key))!);
    expect(saved).toMatchObject({
      version: 3,
      data: {
        onboarded: true,
        activeProfileId: 'default',
        profiles: { default: { household: DEFAULT_HOUSEHOLD, tasks: DEFAULT_TASKS } },
        updatedAt: '2026-10-19T00:00:00.000Z',
      },
    });
  });

  it('removes a stored document', async () => {
    await saveNow(keys.theme, { dark: true, locale: 'en' });
    await remove(keys.theme);
    expect(await AsyncStorage.getItem(themeKey.key)).toBeNull();
  });
});
