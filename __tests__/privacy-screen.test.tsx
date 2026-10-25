import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import Privacy from '../src/app/settings/privacy';
import { DEFAULT_PROFILE_PLAN } from '../src/plan-schema';
import { PlanProvider } from '../src/plan';
import { keys, planKey } from '../src/storage/keys';
import { __resetStorageStateForTests } from '../src/storage/store';

const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
  dismissTo: jest.fn(),
  navigate: jest.fn(),
};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useSegments: () => ['settings'],
  useLocalSearchParams: () => ({}),
  Link: ({ children }: { children: React.ReactNode }) => children,
  Redirect: () => null,
}));

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  const mock = jest.requireActual('react-native-safe-area-context/jest/mock').default;
  return { ...actual, ...mock, default: mock };
});

jest.mock('../src/privacy/lock', () => ({
  PIN_STORAGE_KEY: 'stormready.appPin.v1',
  LOCK_AFTER_MS: 5 * 60 * 1000,
  isFourDigits: (value: string) => /^\d{4}$/.test(value),
  pinsMatch: (stored: string | null, entered: string) => Boolean(stored) && stored === entered.trim(),
  pinSupported: jest.fn(() => true),
  readPin: jest.fn(async () => null),
  writePin: jest.fn(async () => {}),
  clearPin: jest.fn(async () => {}),
}));

// The wipe path also cancels reminders and removes saved map files.
jest.mock('expo-notifications', () => ({
  cancelAllScheduledNotificationsAsync: jest.fn(async () => {}),
}));

jest.mock('expo-file-system/legacy', () => ({
  deleteAsync: jest.fn(async () => {}),
  cacheDirectory: '/cache/',
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => {}),
  EncodingType: { UTF8: 'utf8' },
}));

const lock = jest.requireMock('../src/privacy/lock') as {
  readPin: jest.Mock;
  writePin: jest.Mock;
  clearPin: jest.Mock;
};

async function seedPlan() {
  await AsyncStorage.setItem(planKey.key, JSON.stringify({
    version: keys.plan.version,
    savedAt: '2026-10-19T12:00:00.000Z',
    data: {
      onboarded: true,
      activeProfileId: 'default',
      profiles: { default: DEFAULT_PROFILE_PLAN },
      updatedAt: '2026-10-19T12:00:00.000Z',
    },
  }));
}

beforeEach(async () => {
  __resetStorageStateForTests();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  lock.readPin.mockResolvedValue(null);
  lock.writePin.mockResolvedValue(undefined);
  lock.clearPin.mockResolvedValue(undefined);
});

async function renderPrivacy() {
  return render(
    <PlanProvider>
      <Privacy />
    </PlanProvider>,
  );
}

describe('privacy screen (F12b)', () => {
  it('states the principle and lists what is stored (R-WIP-4)', async () => {
    await seedPlan();
    await renderPrivacy();

    await waitFor(() => expect(screen.getByText('No accounts. No cloud. No analytics. The plan lives in app storage on this device and travels only when you choose to share it.')).toBeTruthy());
    expect(screen.getByText('My plan and checklist')).toBeTruthy();
    expect(screen.getByText('Forgotten PINs have one remedy: uninstall the app. Nothing is recoverable from here.')).toBeTruthy();
  });

  it('turns the PIN on with a choose-plus-repeat confirmation (R-WIP-3)', async () => {
    await seedPlan();
    await renderPrivacy();

    await waitFor(() => expect(screen.getByText('Pin off')).toBeTruthy());
    await fireEvent.press(screen.getByText('Require a PIN'));

    await fireEvent.changeText(screen.getByPlaceholderText('••••'), '1234');
    await fireEvent.press(screen.getByText('Next'));
    expect(screen.getByText('Repeat the PIN')).toBeTruthy();

    await fireEvent.changeText(screen.getByPlaceholderText('••••'), '4321');
    await fireEvent.press(screen.getByText('Turn on'));
    expect(screen.getByText('The two entries do not match. Try again.')).toBeTruthy();

    await fireEvent.changeText(screen.getByPlaceholderText('••••'), '1234');
    await fireEvent.press(screen.getByText('Turn on'));

    await waitFor(() => expect(lock.writePin).toHaveBeenCalledWith('1234'));
    await waitFor(() => expect(screen.getByText('Pin on')).toBeTruthy());
  });

  it('rejects anything that is not four digits', async () => {
    await seedPlan();
    await renderPrivacy();

    await waitFor(() => expect(screen.getByText('Require a PIN')).toBeTruthy());
    await fireEvent.press(screen.getByText('Require a PIN'));

    await fireEvent.changeText(screen.getByPlaceholderText('••••'), '12a4');
    await fireEvent.press(screen.getByText('Next'));

    expect(screen.getByText('Use exactly 4 digits.')).toBeTruthy();
    expect(lock.writePin).not.toHaveBeenCalled();
  });

  it('turns an existing PIN off', async () => {
    lock.readPin.mockResolvedValue('4321');
    await seedPlan();
    await renderPrivacy();

    await waitFor(() => expect(screen.getByText('Pin on')).toBeTruthy());
    await fireEvent.press(screen.getByText('Turn off the PIN'));

    await waitFor(() => expect(lock.clearPin).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Pin off')).toBeTruthy());
  });

  it('requires typing DELETE before wiping everything (R-WIP-1/2)', async () => {
    await seedPlan();
    await renderPrivacy();

    await waitFor(() => expect(screen.getByText('Delete everything')).toBeTruthy());
    await fireEvent.press(screen.getAllByText('Delete everything')[0]);

    expect(screen.getByText('This is permanent')).toBeTruthy();
    await fireEvent.press(screen.getByText('Next'));

    expect(screen.getByText('Type DELETE to confirm')).toBeTruthy();
    await fireEvent.changeText(screen.getByPlaceholderText('DELETE'), 'wipe it');
    await fireEvent.press(screen.getByText('Delete everything')); // the confirm action
    expect(screen.getByText('Typed: DELETE')).toBeTruthy();

    await fireEvent.changeText(screen.getByPlaceholderText('DELETE'), 'DELETE');
    await fireEvent.press(screen.getByText('Delete everything'));

    await waitFor(async () => {
      const doc = JSON.parse((await AsyncStorage.getItem(planKey.key)) ?? '{}');
      expect(doc?.data?.onboarded ?? false).toBe(false);
    });
  });

  it('shows the device authorities without a network call', async () => {
    await seedPlan();
    await renderPrivacy();

    expect(screen.getByText('Ready.gov ↗')).toBeTruthy();
    expect(screen.getByText('Protección Civil ↗')).toBeTruthy();
  });
});
