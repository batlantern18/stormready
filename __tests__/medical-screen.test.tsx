import React from 'react';
import { Alert, Linking, Share } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import Medical from '../src/app/medical';
import { DEFAULT_PROFILE_PLAN } from '../src/plan-schema';
import { PlanProvider } from '../src/plan';
import { keys } from '../src/storage/keys';
import { __resetStorageStateForTests } from '../src/storage/store';
import * as scheduler from '../src/notifications/scheduler';

const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
  dismissTo: jest.fn(),
  navigate: jest.fn(),
};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useSegments: () => ['medical'],
  useLocalSearchParams: () => ({}),
  Link: ({ children }: { children: React.ReactNode }) => children,
  Redirect: () => null,
}));

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  const mock = jest.requireActual('react-native-safe-area-context/jest/mock').default;
  return { ...actual, ...mock, default: mock };
});

jest.mock('../src/notifications/scheduler', () => ({
  setRefillReminder: jest.fn(),
  loadReminderState: jest.fn(),
}));

const loadReminderState = scheduler.loadReminderState as jest.Mock;
const setRefillReminder = scheduler.setRefillReminder as jest.Mock;

const MEDICAL = {
  medications: [{
    id: 'med-1',
    name: 'Insulin',
    dose: '10 units',
    schedule: 'morning and evening',
    days: 14,
    refrigerated: true,
    prescriptionRefillDate: '2026-11-05',
    pharmacy: 'CVS on Main St',
    notes: 'Keep the vial away from the freezer.',
  }],
  devices: [{
    id: 'dev-1',
    name: 'CPAP',
    powerSource: 'mains',
    backupHours: 4,
    needsRefrigeration: false,
  }],
  contacts: [{ id: 'con-1', name: 'Dr. Rivera', phone: '555 0101', role: 'endocrinologist' }],
  allergies: 'Penicillin',
  notes: '',
};

async function seedMedical(medical: Record<string, unknown> = MEDICAL) {
  await AsyncStorage.setItem(keys.plan.key, JSON.stringify({
    version: keys.plan.version,
    savedAt: '2026-10-19T12:00:00.000Z',
    data: {
      onboarded: true,
      activeProfileId: 'default',
      profiles: { default: { ...DEFAULT_PROFILE_PLAN, medical } },
      updatedAt: '2026-10-19T12:00:00.000Z',
    },
  }));
}

async function renderMedical() {
  return render(
    <PlanProvider>
      <Medical />
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
  loadReminderState.mockResolvedValue({ enabled: false, identifiers: {}, updatedAt: null });
  setRefillReminder.mockImplementation(async () => ({ enabled: false, identifiers: { rotation: 'refill-1' }, updatedAt: null }));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('medical screen (F03, R-MED-11)', () => {
  it('starts with the starter card when nothing is recorded', async () => {
    await seedMedical({ medications: [], devices: [], contacts: [], allergies: '', notes: '' });
    await renderMedical();

    await waitFor(() => expect(screen.getByText('Start with one medication or device')).toBeTruthy());
    expect(screen.getAllByText(/Add medication/).length).toBeGreaterThan(0);
    expect(screen.queryByText('1 on the list')).toBeNull();
    expect(screen.queryByText('Remove this plan')).toBeNull();
  });

  it('shows the recorded medications, devices, and contacts with their details', async () => {
    await seedMedical();
    await renderMedical();

    await waitFor(() => expect(screen.getByText(/Insulin/)).toBeTruthy());
    expect(screen.getByText('COLD')).toBeTruthy();
    expect(screen.getByText(/Refill Nov 4, 2026/)).toBeTruthy();
    expect(screen.getByText('Dose: 10 units  ·  Schedule: morning and evening')).toBeTruthy();
    expect(screen.getAllByText(/CPAP/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('4 h backup').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Dr. Rivera/).length).toBeGreaterThan(0);
    expect(screen.getByText('endocrinologist')).toBeTruthy();
  });

  it('calls out the cold-chain plan and CDC guidance (R-MED-7)', async () => {
    await seedMedical();
    await renderMedical();

    await waitFor(() => expect(screen.getByText('A cooler plan before the storm')).toBeTruthy());
    expect(screen.getByText('1 items in this plan need to stay cold. Decide the cooler, ice, and who closes the lid before a storm is named.')).toBeTruthy();
    expect(screen.getByText(/Public guidance on protecting refrigerated medicine/)).toBeTruthy();
  });

  it('adds a medication through the editor and keeps the input on screen', async () => {
    await seedMedical({ ...MEDICAL, medications: [] });
    await renderMedical();

    await waitFor(() => expect(screen.getAllByText('Add medication').length).toBeGreaterThanOrEqual(1));
    await fireEvent.press(screen.getAllByText('Add medication')[0]);

    expect(screen.getByText('Days to carry')).toBeTruthy();
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Insulin, lisinopril'), 'Lisinopril');
    await fireEvent.press(screen.getByText('Save'));

    await waitFor(() => expect(screen.getByText(/Lisinopril/)).toBeTruthy());
  });

  it('collects a refill permission for the earliest refill date and cancels on the second call', async () => {
    await seedMedical();
    await renderMedical();

    const reminder = await screen.findByLabelText('Remind me');
    expect(reminder.props.accessibilityState.checked).toBe(false);

    await fireEvent.press(reminder);
    await waitFor(() => expect(setRefillReminder).toHaveBeenCalledWith('2026-11-05T00:00:00.000Z'));

    await waitFor(() => expect(screen.getByLabelText('Remind me').props.accessibilityState.checked).toBe(true));

    setRefillReminder.mockResolvedValueOnce({ enabled: false, identifiers: {}, updatedAt: null });
    await fireEvent.press(screen.getByLabelText('Remind me'));
    await waitFor(() => expect(setRefillReminder).toHaveBeenLastCalledWith(null));
  });

  it('removes a medication after an explicit confirmation', async () => {
    await seedMedical();
    await renderMedical();

    await waitFor(() => expect(screen.getByText(/Insulin/)).toBeTruthy());
    await fireEvent.press(screen.getByText(/Insulin/));

    await fireEvent.press(screen.getByText('Remove'));
    expect(Alert.alert).toHaveBeenCalledWith('Remove Insulin?', expect.anything(), expect.anything());

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
    buttons.find((button: { text: string }) => button.text === 'Remove').onPress();
    await waitFor(() => expect(screen.queryByText(/Insulin/)).toBeNull());
  });

  it('removes the whole plan only after the destructive confirmation (R-MED-11)', async () => {
    await seedMedical();
    await renderMedical();

    await waitFor(() => expect(screen.getByText('Remove this plan')).toBeTruthy());
    await fireEvent.press(screen.getByText('Remove this plan'));

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
    // "Cancel" has no onPress on purpose — Alert treats style:'cancel' as an
    // implicit dismiss, so pressing Remove this plan without confirming keeps
    // the plan (asserted by the plan still being on screen below).
    expect(screen.getByText(/Insulin/)).toBeTruthy();

    await fireEvent.press(screen.getByText('Remove this plan'));
    const again = (Alert.alert as jest.Mock).mock.calls[1][2];
    again.find((button: { text: string }) => button.text === 'Remove plan').onPress();

    await waitFor(() => expect(screen.getByText('Start with one medication or device')).toBeTruthy());
    expect(screen.queryByText('Remove this plan')).toBeNull();
  });

  it('builds the handout card from the opted-in fields only (R-MED-3)', async () => {
    await seedMedical();
    await renderMedical();

    await waitFor(() => expect(screen.getByText('Choose fields')).toBeTruthy());
    await fireEvent.press(screen.getByText('Choose fields'));

    // Opt-out is per field: doses ship on the card and can be dropped.
    await fireEvent.press(screen.getByLabelText('Doses'));
    await fireEvent.press(screen.getByText('Share the card'));

    await waitFor(() => expect(Share.share).toHaveBeenCalled());
    const message = (Share.share as jest.Mock).mock.calls[0][0].message as string;
    expect(message).toContain('Insulin');
    expect(message).not.toContain('10 units');
  });
});
