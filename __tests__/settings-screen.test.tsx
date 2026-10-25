import React from 'react';
import { Share } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import Settings from '../src/app/(tabs)/settings';
import { renderWithPlan } from './helpers/app';
import * as scheduler from '../src/notifications/scheduler';

jest.mock('../src/notifications/scheduler', () => ({
  enableReminders: jest.fn(),
  disableReminders: jest.fn(),
  loadReminderState: jest.fn(),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() }),
  useSegments: () => ['(tabs)'],
  useLocalSearchParams: () => ({}),
  Link: ({ children }: { children: React.ReactNode }) => children,
  Redirect: () => null,
}));

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  const mock = jest.requireActual('react-native-safe-area-context/jest/mock').default;
  return { ...actual, ...mock, default: mock };
});

const enableReminders = scheduler.enableReminders as jest.Mock;
const disableReminders = scheduler.disableReminders as jest.Mock;
const loadReminderState = scheduler.loadReminderState as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  loadReminderState.mockResolvedValue({ enabled: false, identifiers: {}, updatedAt: null });
  jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Settings screen', () => {
  it('states that the plan stays on the device', async () => {
    await renderWithPlan(<Settings />);

    expect(screen.getByText('Your plan stays in your hands.')).toBeTruthy();
    expect(screen.getByText('Local to this device')).toBeTruthy();
  });

  it('keeps reminders off until the user turns them on', async () => {
    await renderWithPlan(<Settings />);

    await waitFor(() => expect(screen.getByLabelText('Schedule plan reminders')).toBeTruthy());
    expect(screen.getByLabelText('Schedule plan reminders').props.value).toBe(false);

    enableReminders.mockResolvedValue({
      enabled: true,
      state: { enabled: true, identifiers: { checklist: 'a', zone: 'b' }, updatedAt: '2026-10-19T12:00:00.000Z' },
    });

    await fireEvent(screen.getByLabelText('Schedule plan reminders'), 'valueChange', true);

    await waitFor(() => expect(enableReminders).toHaveBeenCalled());
    expect(await screen.findByText(/Reminders are on/)).toBeTruthy();
  });

  it('explains when reminders cannot be scheduled', async () => {
    await renderWithPlan(<Settings />);
    await waitFor(() => expect(screen.getByLabelText('Schedule plan reminders')).toBeTruthy());

    enableReminders.mockResolvedValue({
      enabled: false,
      reason: 'denied',
      state: { enabled: false, identifiers: {}, updatedAt: null },
    });

    await fireEvent(screen.getByLabelText('Schedule plan reminders'), 'valueChange', true);

    expect(await screen.findByText(/Notifications are blocked/)).toBeTruthy();
    expect(screen.getByText('Open notification settings')).toBeTruthy();
  });

  it('turns reminders off again', async () => {
    loadReminderState.mockResolvedValue({ enabled: true, identifiers: { checklist: 'a' }, updatedAt: null });
    disableReminders.mockResolvedValue({ enabled: false, identifiers: {}, updatedAt: null });

    await renderWithPlan(<Settings />);
    await waitFor(() => expect(screen.getByLabelText('Schedule plan reminders').props.value).toBe(true));

    await fireEvent(screen.getByLabelText('Schedule plan reminders'), 'valueChange', false);

    await waitFor(() => expect(disableReminders).toHaveBeenCalled());
    expect(await screen.findByText(/Reminders are off/)).toBeTruthy();
  });

  it('points the share/import entries at the transfer screen (F06)', async () => {
    await renderWithPlan(<Settings />);

    expect(screen.getByText('Share a copy')).toBeTruthy();
    expect(screen.getByText('Import a plan')).toBeTruthy();

    await fireEvent.press(screen.getByText('Share a copy'));
    await fireEvent.press(screen.getByText('Import a plan'));
    await fireEvent.press(screen.getByText('Privacy & data'));
    await fireEvent.press(screen.getByText('Language'));
  });

  it('offers privacy and language controls in one place', async () => {
    await renderWithPlan(<Settings />);

    expect(screen.getByText('Privacy & data')).toBeTruthy();
    expect(screen.getByText('Language')).toBeTruthy();
  });
});
