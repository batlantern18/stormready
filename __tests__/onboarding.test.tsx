import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import Welcome from '../src/app/onboarding/welcome';
import HouseholdStep from '../src/app/onboarding/household';
import ZoneStep from '../src/app/onboarding/zone';
import ReadyStep from '../src/app/onboarding/done';
import { PlanProvider, usePlan } from '../src/plan';
import * as Location from 'expo-location';
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
  useSegments: () => ['onboarding'],
  useLocalSearchParams: () => ({}),
  Link: ({ children }: { children: React.ReactNode }) => children,
  Redirect: () => null,
}));

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  const mock = jest.requireActual('react-native-safe-area-context/jest/mock').default;
  return { ...actual, ...mock, default: mock };
});

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
}));

const mockLocation = Location as unknown as {
  requestForegroundPermissionsAsync: jest.Mock;
  getCurrentPositionAsync: jest.Mock;
};

/** Exposes the current plan so a test can assert on saved state. */
function PlanProbe() {
  const plan = usePlan();
  return <>
    <Text testID="people">{String(plan.household.people)}</Text>
    <Text testID="zone">{plan.zone.value}</Text>
    <Text testID="zone-source">{plan.zone.source}</Text>
    <Text testID="onboarded">{String(plan.onboarded)}</Text>
  </>;
}

async function renderScreen(node: React.ReactNode) {
  // Seed a saved plan so the provider hydrates from a stored document.
  await AsyncStorage.setItem(keys.plan.key, JSON.stringify({
    version: keys.plan.version,
    savedAt: '2026-10-19T12:00:00.000Z',
    data: {
      onboarded: false,
      activeProfileId: 'default',
      profiles: {
        default: {
          household: { people: 2, infants: 0, days: 7, pets: false, petCount: 0, hasVehicle: true, medicalNeeds: false, county: '', accessibilityNeeds: false },
          zone: { value: '', source: 'none', county: '', verifiedAt: null, notes: '', sourceUrl: '' },
          destination: { label: '', address: '', transport: '' },
          tasks: [],
        },
      },
      updatedAt: '2026-10-19T12:00:00.000Z',
    },
  }));

  return render(
    <PlanProvider>
      {node}
      <PlanProbe />
    </PlanProvider>,
  );
}

beforeEach(async () => {
  __resetStorageStateForTests();
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('onboarding welcome step', () => {
  it('explains the four steps and starts the flow', async () => {
    await renderScreen(<Welcome />);

    expect(screen.getByText('STEP 1 OF 4')).toBeTruthy();
    expect(screen.getByText('Ready starts with a few quiet minutes.')).toBeTruthy();
    expect(screen.getByText('Your evacuation zone')).toBeTruthy();

    await fireEvent.press(screen.getByText('Start my plan'));
    expect(mockRouter.push).toHaveBeenCalledWith('/onboarding/household');
  });

  it('can be skipped without setting up a plan', async () => {
    await renderScreen(<Welcome />);

    await fireEvent.press(screen.getByLabelText('Skip onboarding'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)'));
    expect(screen.getByTestId('onboarded').props.children).toBe('true');
  });

  it('never asks for location permission', async () => {
    await renderScreen(<Welcome />);
    await fireEvent.press(screen.getByText('Start my plan'));
    expect(mockLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mockLocation.getCurrentPositionAsync).not.toHaveBeenCalled();
  });
});

describe('onboarding household step', () => {
  it('shows the household questions and advances to the zone step', async () => {
    await renderScreen(<HouseholdStep />);

    expect(screen.getByText('STEP 2 OF 4')).toBeTruthy();
    expect(screen.getByText('Who are you planning for?')).toBeTruthy();

    await fireEvent.press(screen.getByText('Continue to zone'));
    expect(mockRouter.push).toHaveBeenCalledWith('/onboarding/zone');
  });

  it('stores the household size in the plan', async () => {
    await renderScreen(<HouseholdStep />);

    await fireEvent.press(screen.getByLabelText('Increase People in your household'));
    await waitFor(() => expect(screen.getByTestId('people').props.children).toBe('3'));

    await fireEvent.press(screen.getByLabelText('Increase People in your household'));
    await waitFor(() => expect(screen.getByTestId('people').props.children).toBe('4'));
  });

  it('never asks for location permission', async () => {
    await renderScreen(<HouseholdStep />);
    expect(mockLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('onboarding zone step', () => {
  it('saves a manually verified zone with its provenance', async () => {
    await renderScreen(<ZoneStep />);

    expect(screen.getByText('STEP 3 OF 4')).toBeTruthy();

    await fireEvent.changeText(screen.getByPlaceholderText('Enter the zone shown by your local authority'), 'Zone C');
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Harris County'), 'Harris County');
    await fireEvent.changeText(screen.getByPlaceholderText('Where you found it, or what to check next'), 'From the county site');
    await fireEvent.changeText(screen.getByPlaceholderText('https://…'), 'https://example.gov/zone');

    await fireEvent.press(screen.getByText('Save zone and continue'));

    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/onboarding/done'));
    expect(screen.getByTestId('zone').props.children).toBe('Zone C');
    expect(screen.getByTestId('zone-source').props.children).toBe('manual');
  });

  it('rejects a source address that is not a web address', async () => {
    await renderScreen(<ZoneStep />);

    await fireEvent.changeText(screen.getByPlaceholderText('Enter the zone shown by your local authority'), 'Zone C');
    await fireEvent.changeText(screen.getByPlaceholderText('https://…'), 'not a url');

    await fireEvent.press(screen.getByText('Save zone and continue'));

    expect(await screen.findByText('Enter a full http or https web address.')).toBeTruthy();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('can be continued without a zone', async () => {
    await renderScreen(<ZoneStep />);

    await fireEvent.press(screen.getByText('Continue without a zone'));
    expect(mockRouter.push).toHaveBeenCalledWith('/onboarding/done');
  });
});

describe('onboarding ready step', () => {
  it('summarises the plan and finishes setup', async () => {
    await renderScreen(<ReadyStep />);

    expect(screen.getByText('STEP 4 OF 4')).toBeTruthy();
    expect(screen.getByText('Your plan is ready to keep.')).toBeTruthy();

    await fireEvent.press(screen.getByText('Open my plan'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/plan'));
    expect(screen.getByTestId('onboarded').props.children).toBe('true');
  });
});
