import React from 'react';
import { Alert, Share } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import GoBags from '../src/app/go-bags';
import GoBagDetail from '../src/app/go-bags/[id]';
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
  useSegments: () => ['go-bags'],
  useLocalSearchParams: () => ({ id: 'bag-1' }),
  Link: ({ children }: { children: React.ReactNode }) => children,
  Redirect: () => null,
}));

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  const mock = jest.requireActual('react-native-safe-area-context/jest/mock').default;
  return { ...actual, ...mock, default: mock };
});

const BAG = {
  id: 'bag-1',
  name: 'Maya — school bag',
  owner: 'Maya',
  location: 'closet by the front door',
  template: 'personal',
  itemIds: ['water', 'flashlights'],
  packed: { water: true },
  note: '',
  createdAt: '2026-10-01T12:00:00.000Z',
};

async function seedBags(bags: Record<string, unknown>[] = []) {
  await AsyncStorage.setItem(keys.plan.key, JSON.stringify({
    version: keys.plan.version,
    savedAt: '2026-10-19T12:00:00.000Z',
    data: {
      onboarded: true,
      activeProfileId: 'default',
      profiles: { default: { ...DEFAULT_PROFILE_PLAN, goBags: { bags } } },
      updatedAt: '2026-10-19T12:00:00.000Z',
    },
  }));
}

async function renderGoBags() {
  return render(
    <PlanProvider>
      <GoBags />
    </PlanProvider>,
  );
}

async function renderBagDetail() {
  return render(
    <PlanProvider>
      <GoBagDetail />
    </PlanProvider>,
  );
}

beforeEach(async () => {
  __resetStorageStateForTests();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('go-bags screen (F02)', () => {
  it('starts from an empty state with two ways in', async () => {
    await seedBags();
    await renderGoBags();

    await waitFor(() => expect(screen.getByText('No bags yet')).toBeTruthy());
    expect(screen.getByText('Add a blank bag')).toBeTruthy();
    expect(screen.getByText('Suggest bags from my household')).toBeTruthy();
  });

  it('creates a blank bag from a template and opens it (R-BAG-2)', async () => {
    await seedBags();
    await renderGoBags();

    await fireEvent.press(screen.getByText('Add a blank bag'));
    expect(screen.getByText('Start from a template')).toBeTruthy();
    expect(screen.getByText('10 items')).toBeTruthy();

    await fireEvent.press(screen.getByText('○ Vehicle kit'));
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Maya — school bag'), 'Car bag');
    await fireEvent.press(screen.getByText('Create this bag'));

    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith(expect.stringMatching('/go-bags/bag-')));
  });

  it('suggests one bag per person from the household (R-BAG-7)', async () => {
    await seedBags();
    await renderGoBags();

    await fireEvent.press(screen.getByText('Suggest bags from my household'));

    await waitFor(() => expect(screen.getByText('Personal go-bag')).toBeTruthy());
    expect(screen.getByText('Personal go-bag 2')).toBeTruthy();
    expect(screen.getAllByText('0 of 10 packed').length).toBeGreaterThan(0);
  });

  it('lists a bag with its owner, location, and progress', async () => {
    await seedBags([BAG]);
    await renderGoBags();

    await waitFor(() => expect(screen.getByText('Maya — school bag')).toBeTruthy());
    expect(screen.getByText('Who: Maya')).toBeTruthy();
    expect(screen.getByText('Lives: closet by the front door')).toBeTruthy();
    expect(screen.getByText('1 of 2 packed')).toBeTruthy();

    await fireEvent.press(screen.getByText('Open'));
    expect(mockRouter.push).toHaveBeenCalledWith('/go-bags/bag-1');
  });

  it('removes a bag but never silent', async () => {
    await seedBags([BAG]);
    await renderGoBags();

    await waitFor(() => expect(screen.getByText('Remove bag')).toBeTruthy());
    await fireEvent.press(screen.getByText('Remove bag'));

    expect(Alert.alert).toHaveBeenCalledWith(
      'Remove Maya — school bag?',
      expect.anything(),
      expect.anything(),
    );

    
    // 'Cancel' relies on Alert style:'cancel' (no onPress); leaving it alone keeps the bag.
    expect(screen.getByText('Maya — school bag')).toBeTruthy();

    await fireEvent.press(screen.getByText('Remove bag'));
    const again = (Alert.alert as jest.Mock).mock.calls[1][2];
    again.find((button: { text: string }) => button.text === 'Remove').onPress();

    await waitFor(() => expect(screen.getByText('No bags yet')).toBeTruthy());
  });
});

describe('go-bag runner screen (F02, R-BAG-1/3/5)', () => {
  it('shows a bag that owns nothing in the plan gracefully', async () => {
    await seedBags();
    await renderBagDetail();

    await waitFor(() => expect(screen.getByText('Missing from the kit')).toBeTruthy());
    expect(screen.getByText('Back to the bags')).toBeTruthy();
  });

  it('tracks packed progress per item and shares plain text (R-BAG-5)', async () => {
    await seedBags([BAG]);
    await renderBagDetail();

    await waitFor(() => expect(screen.getByText('1 of 2 packed')).toBeTruthy());
    expect(screen.getAllByText('1 of 2 packed').length).toBeGreaterThanOrEqual(1);
    const water = screen.getByLabelText('Drinking water — Packed');
    expect(water.props.accessibilityState.checked).toBe(true);

    await fireEvent.press(water);
    await waitFor(() => expect(screen.getByText('0 of 2 packed')).toBeTruthy());

    await fireEvent.press(screen.getByText('Share this bag'));
    await waitFor(() => expect(Share.share).toHaveBeenCalled());
    const message = (Share.share as jest.Mock).mock.calls[0][0].message as string;
    expect(message).toContain('Maya — school bag');
    expect(message).toContain('Drinking water');
  });

  it('copies kit lines into the bag through the picker (R-BAG-4)', async () => {
    await seedBags([BAG]);
    await renderBagDetail();

    await waitFor(() => expect(screen.getByText('Copy to this bag')).toBeTruthy());
    await fireEvent.press(screen.getByText('Copy to this bag'));

    expect(screen.getByText('Kit items this bag does not include yet.')).toBeTruthy();
    await fireEvent.press(screen.getAllByText('Choose items')[0]);

    await waitFor(() => expect(screen.getByText('1 of 3 packed')).toBeTruthy());
  });

  it('keeps disappeared kit lines visible with their own card (R-BAG-1)', async () => {
    await seedBags([{ ...BAG, itemIds: ['water', 'bogus-line'] }]);
    await renderBagDetail();

    await waitFor(() => expect(screen.getByText('NOT IN KIT')).toBeTruthy());
    expect(screen.getByText('bogus-line')).toBeTruthy();

    await fireEvent.press(screen.getByText('Remove from bag'));
    await waitFor(() => expect(screen.queryByText('bogus-line')).toBeNull());
  });
});
