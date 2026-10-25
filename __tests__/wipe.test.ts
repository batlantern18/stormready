import AsyncStorage from '@react-native-async-storage/async-storage';
import { keys, planKey, themeKey, alertsKey, areaKey, destinationKey, notificationsKey } from '../src/storage/keys';
import { keysForWipe, privacyDescriptorList, wipeAllData } from '../src/storage/wipe';
import { saveNow } from '../src/storage/store';
import { __resetStorageStateForTests } from '../src/storage/store';

jest.mock('expo-notifications', () => ({
  cancelAllScheduledNotificationsAsync: jest.fn(async () => {}),
}));

jest.mock('expo-file-system/legacy', () => ({
  deleteAsync: jest.fn(async () => {}),
}));

const Notifications = jest.requireMock('expo-notifications') as {
  cancelAllScheduledNotificationsAsync: jest.Mock;
};
const FileSystem = jest.requireMock('expo-file-system/legacy') as {
  deleteAsync: jest.Mock;
};

beforeEach(async () => {
  __resetStorageStateForTests();
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('keysForWipe (R-WIP-1)', () => {
  it('lists every key, its quarantine copy, and legacy keys', () => {
    const list = keysForWipe();
    for (const spec of [planKey, themeKey, alertsKey, areaKey, destinationKey, notificationsKey]) {
      expect(list).toContain(spec.key);
      expect(list).toContain(`${spec.key}.corrupt`);
    }
    expect(list).toContain(planKey.legacyKey!);
    expect(list).toContain(`${planKey.legacyKey!}.corrupt`);
  });
});

describe('privacy list (R-WIP-4, R-WIP-10)', () => {
  it('describes every key in keys.ts exactly once', () => {
    const list = privacyDescriptorList();
    const specKeys = Object.values(keys).map(spec => spec.key);
    expect(list.map(entry => entry.key).sort()).toEqual([...specKeys].sort());
    for (const entry of list) {
      expect(entry.title).toBeTruthy();
      expect(entry.description).toBeTruthy();
    }
    // The plan document is marked sensitive and its copy says so in plain language.
    const plan = list.find(entry => entry.key === planKey.key)!;
    expect(plan.sensitive).toBe(true);
  });
});

describe('wipeAllData', () => {
  it('removes every user document, area file, and reminder (R-WIP-9)', async () => {
    await saveNow(planKey, { ...JSON.parse(JSON.stringify(keys.plan.defaultValue)), onboarded: true });
    await saveNow(areaKey, { default: { center: { latitude: 0, longitude: 0 }, radiusMeters: 0, savedAt: '', countyMapUri: 'file:///areas/county.geojson' } as never });
    await saveNow(themeKey, { dark: true, locale: 'es' });
    await AsyncStorage.setItem('stormready.plan.v2', '{"onboarded":true}');
    await AsyncStorage.setItem(`${planKey.key}.corrupt`, 'junk');

    FileSystem.deleteAsync.mockResolvedValue(undefined);

    const { clearedKeys, deletedFiles } = await wipeAllData();

    expect(clearedKeys).toEqual(expect.arrayContaining(keysForWipe()));
    for (const key of keysForWipe()) {
      expect(await AsyncStorage.getItem(key)).toBeNull();
    }
    expect(deletedFiles).toEqual(['file:///areas/county.geojson']);
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///areas/county.geojson', { idempotent: true });
    expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalled();
  });

  it('continues when a key cannot be removed', async () => {
    const spy = jest.spyOn(AsyncStorage, 'removeItem').mockRejectedValueOnce(new Error('disk busy'));
    await expect(wipeAllData()).resolves.toBeTruthy();
    spy.mockRestore();
  });
});
