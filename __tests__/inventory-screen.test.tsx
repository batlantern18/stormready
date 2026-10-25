import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import Inventory from '../src/app/inventory';
import { DEFAULT_PROFILE_PLAN } from '../src/plan-schema';
import { PlanProvider } from '../src/plan';
import { keys } from '../src/storage/keys';
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
  useSegments: () => ['inventory'],
  useLocalSearchParams: () => ({}),
  Link: ({ children }: { children: React.ReactNode }) => children,
  Redirect: () => null,
}));

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  const mock = jest.requireActual('react-native-safe-area-context/jest/mock').default;
  return { ...actual, ...mock, default: mock };
});

async function seedInventory(entries: Record<string, unknown> = {}, lastRotationAt: string | null = null) {
  await AsyncStorage.setItem(keys.plan.key, JSON.stringify({
    version: keys.plan.version,
    savedAt: '2026-10-19T12:00:00.000Z',
    data: {
      onboarded: true,
      activeProfileId: 'default',
      profiles: {
        default: {
          ...DEFAULT_PROFILE_PLAN,
          inventory: { entries, lastRotationAt },
        },
      },
      updatedAt: '2026-10-19T12:00:00.000Z',
    },
  }));
}

async function renderInventory() {
  return render(
    <PlanProvider>
      <Inventory />
    </PlanProvider>,
  );
}

beforeEach(async () => {
  __resetStorageStateForTests();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('inventory screen (F01)', () => {
  it('shows the coverage card and the two core items before anything is owned', async () => {
    await seedInventory();
    await renderInventory();

    await waitFor(() => expect(screen.getByText('Water & food coverage')).toBeTruthy());
    expect(screen.getAllByText('Drinking water').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Shelf-stable food').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('The bars compare what you own with what your household needs for the days you set. They are estimates, not inventory credits.')).toBeTruthy();
    expect(screen.queryByText('Covered')).toBeNull();
    expect(screen.getAllByText('Not tracked').length).toBeGreaterThan(0);
  });

  it('marks coverage as covered once the required quantity is owned', async () => {
    await seedInventory({
      water: { itemId: 'water', owned: true, quantityOwned: 14, purchasedAt: '2026-09-15', expiresAt: null, note: 'garage shelf' },
    });
    await renderInventory();

    await waitFor(() => expect(screen.getAllByText('Drinking water').length).toBeGreaterThanOrEqual(1));
    await waitFor(() => expect(screen.getByText('Covered')).toBeTruthy());
    expect(screen.getByText(/14 on hand · bought Sep 14, 2026 /)).toBeTruthy();
    expect(screen.getByText(/Note: garage shelf/)).toBeTruthy();
  });

  it('records an owned item from the editor and recomputes coverage (R-INV-6)', async () => {
    await seedInventory();
    await renderInventory();

    await waitFor(() => expect(screen.getByText('▸ Drinking water')).toBeTruthy());
    await fireEvent.press(screen.getByText('▸ Drinking water'));

    expect(screen.getByText('Owned')).toBeTruthy();
    await fireEvent.press(screen.getByText('Owned')); // the toggle decides ownership
    await fireEvent.press(screen.getByText('Save'));

    await waitFor(() => expect(screen.getByText('Covered')).toBeTruthy());
    expect(screen.getByText('14 on hand · bought no date · expires no date')).toBeTruthy();
  });

  it('flags expired and expiring items with their dates (R-INV-8)', async () => {
    await seedInventory({
      water: { itemId: 'water', owned: true, quantityOwned: 4, purchasedAt: '2025-09-15', expiresAt: '2026-01-01', note: '' },
      food: { itemId: 'food', owned: true, quantityOwned: 6, purchasedAt: '2025-10-01', expiresAt: '2026-11-15', note: '' },
    });
    await renderInventory();

    await waitFor(() => expect(screen.getByText('REPLACE NOW')).toBeTruthy());
    expect(screen.getByText('Expired Dec 31, 2025')).toBeTruthy();
    expect(screen.getByText('Expires Nov 14, 2026')).toBeTruthy();
    // The editor opens from the expiry card, so the entries can be corrected.
    await fireEvent.press(screen.getAllByText('Edit')[0]);
    expect(screen.getByText('How many you own')).toBeTruthy();
  });

  it('labels an owned but unstocked item on the shopping list', async () => {
    await seedInventory({
      food: { itemId: 'food', owned: false, quantityOwned: 0, purchasedAt: null, expiresAt: null, note: '' },
    });
    await renderInventory();

    await waitFor(() => expect(screen.getByText('Not owned')).toBeTruthy());
    expect(screen.getByText('On the shopping list — not yet in the house.')).toBeTruthy();
  });

  it('offers the seasonal rotation stamp and records it', async () => {
    await seedInventory({
      water: { itemId: 'water', owned: true, quantityOwned: 4, purchasedAt: null, expiresAt: null, note: '' },
    });
    await renderInventory();

    await waitFor(() => expect(screen.getByText('Rotate your supplies')).toBeTruthy());
    expect(screen.getByText('I rotated today')).toBeTruthy();

    await fireEvent.press(screen.getByText('I rotated today'));

    // The stamp is persisted to the plan store, so the card flips to the date view.
    await waitFor(() => expect(screen.getByText(/Next suggested rotation:/)).toBeTruthy());
  });

  it('asks for confirmation before clearing ownership records', async () => {
    await seedInventory({
      water: { itemId: 'water', owned: true, quantityOwned: 4, purchasedAt: '2026-09-15', expiresAt: null, note: '' },
    });
    await renderInventory();

    await waitFor(() => expect(screen.getByText('Start empty')).toBeTruthy());
    await fireEvent.press(screen.getByText('Start empty'));

    expect(Alert.alert).toHaveBeenCalledWith(
      'Start empty?',
      'Clears ownership for every item. The kit list itself stays untouched.',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel' }),
        expect.objectContaining({ text: 'Start empty', style: 'destructive' }),
      ]),
    );

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
    const confirm = buttons.find((button: { text: string }) => button.text === 'Start empty')!;
    confirm.onPress();

    await waitFor(() => expect(screen.getByText('Not tracked')).toBeTruthy());
    expect(screen.queryByText('Covered')).toBeNull();
  });
});
