import React from 'react';
import { Alert, Linking, Share } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import Communication from '../src/app/communication';
import { DEFAULT_PROFILE_PLAN, type VerifiedZone } from '../src/plan-schema';
import { DEFAULT_ZONE } from './helpers/app';
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
  useSegments: () => ['communication'],
  useLocalSearchParams: () => ({}),
  Link: ({ children }: { children: React.ReactNode }) => children,
  Redirect: () => null,
}));

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  const mock = jest.requireActual('react-native-safe-area-context/jest/mock').default;
  return { ...actual, ...mock, default: mock };
});

const CONTACT = { id: 'con-1', name: 'Aunt Rosa', phone: '(512) 555-0100', relationship: 'aunt', distance: '240 miles' };

const COMMS = {
  contacts: [CONTACT],
  meetingPoint: { label: 'the library steps', address: '200 Riverview Dr', note: '' },
  checkIn: { who: 'everyone texts Rosa', everyHours: 12, method: 'text first', fallback: 'leave a note' },
  backup: { contact: '', method: '', note: '' },
};

async function seedComms(communication = COMMS, zone: VerifiedZone = { value: '', source: 'none', county: '', verifiedAt: null, notes: '', sourceUrl: '', country: 'US' }) {
  await AsyncStorage.setItem(keys.plan.key, JSON.stringify({
    version: keys.plan.version,
    savedAt: '2026-10-19T12:00:00.000Z',
    data: {
      onboarded: true,
      activeProfileId: 'default',
      profiles: { default: { ...DEFAULT_PROFILE_PLAN, communication, zone } },
      updatedAt: '2026-10-19T12:00:00.000Z',
    },
  }));
}

async function renderComms() {
  return render(
    <PlanProvider>
      <Communication />
    </PlanProvider>,
  );
}

beforeEach(async () => {
  __resetStorageStateForTests();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
  jest.spyOn(Linking, 'openURL').mockResolvedValue({} as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('communication screen (F04)', () => {
  it('names the four parts and keeps every part editable offline', async () => {
    await seedComms({ ...COMMS, contacts: [] });
    await renderComms();

    await waitFor(() => expect(screen.getByText('Plan completeness')).toBeTruthy());
    expect(screen.getByText('Four parts make a plan: contact, meeting place, check-in, backup.')).toBeTruthy();
    expect(screen.getByText('The kit list carries this plan')).toBeTruthy();
    expect(screen.getAllByText('Meeting place').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Check-in routine')).toBeTruthy();
    expect(screen.getByText('Backup plan')).toBeTruthy();
  });

  it('adds a contact through the editor and shows the call link (R-COM-1)', async () => {
    await seedComms({ ...COMMS, contacts: [] });
    await renderComms();

    await waitFor(() => expect(screen.getByText('Add person')).toBeTruthy());
    await fireEvent.press(screen.getByText('Add person'));

    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Aunt Rosa in Austin'), 'Aunt Rosa');
    await fireEvent.changeText(screen.getByPlaceholderText('Full number, country code included'), '(512) 555-0100');
    await fireEvent.press(screen.getByText('Save'));

    await waitFor(() => expect(screen.getByText(/Aunt Rosa/)).toBeTruthy());
    expect(screen.getByText('Phone on file')).toBeTruthy();
    expect(screen.getByText('Call (512) 555-0100')).toBeTruthy();

    await fireEvent.press(screen.getByText('Call (512) 555-0100'));
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith('tel:(512) 555-0100'));
  });

  it('carries the zone on the shareable card with its provenance (R-COM-2)', async () => {
    await seedComms(COMMS, {
      ...DEFAULT_ZONE,
      value: 'Zone C',
      source: 'manual',
      county: 'Hillsborough County',
      verifiedAt: '2026-10-19T12:00:00.000Z',
    });
    await renderComms();

    await waitFor(() => expect(screen.getByText('Shareable card')).toBeTruthy());
    expect(screen.getByText(/Evacuation zone on file: Zone C/)).toBeTruthy();

    await fireEvent.press(screen.getByText('Share the card'));
    await waitFor(() => expect(Share.share).toHaveBeenCalled());
    const message = (Share.share as jest.Mock).mock.calls[0][0].message as string;
    expect(message).toContain('Aunt Rosa');
    expect(message).toContain('Zone C');
    expect(message).not.toContain('Backup');
  });

  it('says plainly that no zone exists yet', async () => {
    await seedComms();
    await renderComms();

    await waitFor(() => expect(screen.getByText('Evacuation zone on file: No zone recorded · Not recorded')).toBeTruthy());
  });

  it('stores a check-in cadence through one of the interval buttons', async () => {
    await seedComms();
    await renderComms();

    await waitFor(() => expect(screen.getByText('Check-in routine')).toBeTruthy());
    await fireEvent.press(screen.getByText('Every 6 h'));

    // The cadence choice persists in the plan document.
    await waitFor(
      async () => {
        const doc = JSON.parse((await AsyncStorage.getItem(keys.plan.key)) ?? '{}');
        expect(doc?.data?.profiles?.default?.communication?.checkIn?.everyHours).toBe(6);
      },
    );
  });

  it('removes a contact after a confirmation (R-COM-9)', async () => {
    await seedComms();
    await renderComms();

    await waitFor(() => expect(screen.getByText(/Aunt Rosa/)).toBeTruthy());
    await fireEvent.press(screen.getByText(/Aunt Rosa/));
    await fireEvent.press(screen.getByText('Remove'));

    expect(Alert.alert).toHaveBeenCalledWith(
      'Remove Aunt Rosa?',
      'This person leaves your plan.',
      expect.anything(),
    );

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
    buttons.find((button: { text: string }) => button.text === 'Remove').onPress();

    await waitFor(() => expect(screen.queryByText(/Aunt Rosa/)).toBeNull());
  });
});
