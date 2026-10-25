import React from 'react';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react-native';import AsyncStorage from '@react-native-async-storage/async-storage';

import { __resetStorageStateForTests } from '../src/storage/store';

import RootLayout from '../src/app/_layout';

const mockRedirects: string[] = [];

jest.mock('expo-router', () => {
  const elements = require('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) => children;
  // The stack passes children straight through, and its Screen registrations
  // (which only configure native navigation) render as nothing.
  const mockStack = ({ children }: { children: React.ReactNode }) => children;
  mockStack.Screen = () => null;
  return {
    Stack: mockStack,
    Redirect: ({ href }: { href: string }) => {
      mockRedirects.push(href);
      return null;
    },
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() }),
    useSegments: () => ['(tabs)'],
    useLocalSearchParams: () => ({}),
    Link: passthrough,
  };
});

jest.mock('react-native-gesture-handler', () => {
  const elements = require('react');
  return { GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => children };
});

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  const mock = jest.requireActual('react-native-safe-area-context/jest/mock').default;
  return { ...actual, ...mock, default: mock };
});

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
}));

let mockPin: string | null = null;

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => mockPin),
  setItemAsync: jest.fn(async (_key: string, value: string) => { mockPin = value; }),
  deleteItemAsync: jest.fn(async () => { mockPin = null; }),
}));

beforeEach(async () => {
  // Leftover debounced writes from a previous tree must not clobber this
  // test's seed (the 250 ms timer can fire across tests).
  __resetStorageStateForTests();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockRedirects.length = 0;
  mockPin = null;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('root layout (F12b gate + F10 locale wiring)', () => {
  it('starts a fresh device on the onboarding welcome (F06 boot)', async () => {
    await render(<RootLayout />);

    await waitFor(() => expect(mockRedirects).toContain('/onboarding/welcome'));
  });

  it('renders the app shell once the plan is onboarded and there is no PIN', async () => {
    await AsyncStorage.setItem('stormready.plan.v3', JSON.stringify({
      version: 3,
      savedAt: '2026-10-19T12:00:00.000Z',
      data: { onboarded: true, activeProfileId: 'default', profiles: { default: {} }, updatedAt: '2026-10-19T12:00:00.000Z' },
    }));
    await render(<RootLayout />);

    await waitFor(() => expect(mockRedirects).toEqual([]));
    expect(screen.queryByText('Locked')).toBeNull();
  });

  it('asks for the device PIN on launch and unlocks with it (R-WIP-11)', async () => {
    mockPin = '4321';
    await AsyncStorage.setItem('stormready.plan.v3', JSON.stringify({
      version: 3,
      savedAt: '2026-10-19T12:00:00.000Z',
      data: { onboarded: true, activeProfileId: 'default', profiles: { default: {} }, updatedAt: '2026-10-19T12:00:00.000Z' },
    }));
    await render(<RootLayout />);

    await waitFor(() => expect(screen.getByText('Locked')).toBeTruthy());
    expect(screen.getByText('0 of 4 entered')).toBeTruthy();
    expect(screen.getByText('A forgotten PIN is only solved by reinstalling the app. That deletes the plan.')).toBeTruthy();

    // Wrong entry first: the error stays local (R-WIP-5).
    for (const digit of ['9', '8', '7', '6']) {
      await fireEvent.press(screen.getByText(digit));
    }
    await fireEvent.press(screen.getByText('Unlock'));
    await waitFor(() => expect(screen.getByText('That is not the PIN. It stays on the device — nothing is sent anywhere.')).toBeTruthy());

    for (const digit of ['⌫', '⌫', '⌫', '⌫']) {
      await fireEvent.press(screen.getByLabelText('Delete'));
    }
    for (const digit of ['4', '3', '2', '1']) {
      await fireEvent.press(screen.getByText(digit));
    }
    await fireEvent.press(screen.getByText('Unlock'));

    await waitFor(() => expect(screen.queryByText('Locked')).toBeNull());
  });
});
