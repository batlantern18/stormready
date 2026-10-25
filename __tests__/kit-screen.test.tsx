import React from 'react';
import { DEFAULT_PROFILE_PLAN } from '../src/plan-schema';
import { Share, Text } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import KitScreen from '../src/app/kit';
import { PlanProvider, usePlan } from '../src/plan';
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
  useSegments: () => ['kit'],
  useLocalSearchParams: () => ({}),
  Link: ({ children }: { children: React.ReactNode }) => children,
  Redirect: () => null,
}));

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  const mock = jest.requireActual('react-native-safe-area-context/jest/mock').default;
  return { ...actual, ...mock, default: mock };
});

const HOUSEHOLD = {
  people: 2,
  infants: 0,
  days: 7,
  pets: false,
  petCount: 0,
  hasVehicle: true,
  medicalNeeds: false,
  county: '',
  accessibilityNeeds: false,
};

async function seedPlan(household: Record<string, unknown> = HOUSEHOLD) {
  await AsyncStorage.setItem(keys.plan.key, JSON.stringify({
    version: keys.plan.version,
    savedAt: '2026-10-19T12:00:00.000Z',
    data: {
      onboarded: true,
      activeProfileId: 'default',
      profiles: {
        default: {
          // Match what a migrated v1.1 document looks like: every v1.2 section present.
          ...DEFAULT_PROFILE_PLAN,
          household,
          zone: { value: '', source: 'none', county: '', verifiedAt: null, notes: '', sourceUrl: '', country: 'US' },
          destination: { label: '', address: '', transport: '' },
          tasks: [],
        },
      },
      updatedAt: '2026-10-19T12:00:00.000Z',
    },
  }));
}

/** Renders the kit screen with a control that edits the household. */
function KitHarness() {
  const plan = usePlan();
  return <>
    <KitScreen />
    <Text testID="grow-household" onPress={() => plan.setHousehold({ people: 5 })}>grow</Text>
  </>;
}

function renderKit() {
  // `render` is asynchronous in React Native Testing Library v14. Awaiting it
  // also lets the plan provider finish hydrating from storage.
  return render(
    <PlanProvider>
      <KitHarness />
    </PlanProvider>,
  );
}

beforeEach(async () => {
  __resetStorageStateForTests();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('kit screen', () => {
  it('shows the household the kit is sized for', async () => {
    await seedPlan({ ...HOUSEHOLD, people: 4, infants: 1, pets: true, petCount: 1, days: 10 });
    await renderKit();

    await waitFor(() => expect(screen.getByText('4 people · 1 infant · 1 pet · 10 days')).toBeTruthy());
    expect(screen.getByText('Sized for your household.')).toBeTruthy();
  });

  it('lists every line with a quantity, a basis, and an official source', async () => {
    await seedPlan();
    await renderKit();

    await waitFor(() => expect(screen.getAllByText("Drinking water").length).toBeGreaterThanOrEqual(1));
    expect(screen.getByText('14 gal')).toBeTruthy();
    expect(screen.getByText('Basis: 2 people × 7 days × 1 gallon per person per day')).toBeTruthy();
    expect(screen.getByLabelText('Open source: Ready.gov — Water')).toBeTruthy();
  });

  it('shares a plain-text kit list through the system share sheet', async () => {
    await seedPlan();
    await renderKit();
    await waitFor(() => expect(screen.getAllByText("Drinking water").length).toBeGreaterThanOrEqual(1));

    await fireEvent.press(screen.getByText('Share kit list'));
    await waitFor(() => expect(Share.share).toHaveBeenCalled());

    const payload = (Share.share as jest.Mock).mock.calls[0][0];
    expect(payload.title).toBe('My StormReady emergency kit');
    expect(payload.message).toContain('14 gal');
    expect(payload.message).toContain('Ready.gov');
  });

  it('returns to the previous screen', async () => {
    await renderKit();
    await waitFor(() => expect(screen.getByLabelText('Go back')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Go back'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
  });

  it('recomputes the kit when the household changes', async () => {
    await seedPlan();
    await renderKit();
    await waitFor(() => expect(screen.getByText('14 gal')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('grow-household'));
    await waitFor(() => expect(screen.getByText('35 gal')).toBeTruthy());
    expect(screen.queryByText('14 gal')).toBeNull();
  });

  it('states that the list is a planning baseline, not an official requirement', async () => {
    await seedPlan();
    await renderKit();
    await waitFor(() => expect(screen.getAllByText("Drinking water").length).toBeGreaterThanOrEqual(1));
    expect(screen.getByText(/This is a planning baseline, not an official requirement/)).toBeTruthy();
  });
});
