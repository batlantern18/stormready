import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import Transfer from '../src/app/settings/transfer';
import { DEFAULT_PROFILE_PLAN, DEFAULT_TASKS } from '../src/plan-schema';
import { PlanProvider } from '../src/plan';
import {
  DEFAULT_EXPORT_OPTIONS,
  buildEnvelope,
  type PlanEnvelope,
} from '../src/transfer/model';
import * as file from '../src/transfer/file';
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

jest.mock('../src/transfer/file', () => ({
  pickPlanFile: jest.fn(),
  shareEnvelope: jest.fn(),
  deleteExportFile: jest.fn(async () => {}),
}));

const pickPlanFile = file.pickPlanFile as jest.Mock;
const shareEnvelope = file.shareEnvelope as jest.Mock;
const exportedAt = '2026-10-01T12:00:00.000Z';

function envelopeFor(profile: Partial<typeof DEFAULT_PROFILE_PLAN> = {}, optionsOverride: Partial<typeof DEFAULT_EXPORT_OPTIONS> = {}): PlanEnvelope {
  const awayBag = { id: 'away-1', name: 'Away bag', owner: '', location: '', template: 'personal' as const, itemIds: [], packed: {}, note: '', createdAt: exportedAt };
  return buildEnvelope(
    { ...DEFAULT_PROFILE_PLAN, goBags: { bags: [awayBag] }, ...profile },
    { ...DEFAULT_EXPORT_OPTIONS, ...optionsOverride },
    { planId: 'plan-remote', exportedAt },
  );
}

async function seedPlan() {
  await AsyncStorage.setItem(keys.plan.key, JSON.stringify({
    version: keys.plan.version,
    savedAt: '2026-10-19T12:00:00.000Z',
    data: {
      onboarded: true,
      activeProfileId: 'default',
      profiles: {
        default: {
          ...DEFAULT_PROFILE_PLAN,
          tasks: DEFAULT_TASKS.map(task => ({ ...task, done: false })),
          goBags: { bags: [] },
        },
      },
      updatedAt: '2026-10-19T12:00:00.000Z',
    },
  }));
}

beforeEach(async () => {
  __resetStorageStateForTests();
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

async function renderTransfer() {
  return render(
    <PlanProvider>
      <Transfer />
    </PlanProvider>,
  );
}

describe('transfer screen (F06)', () => {
  it('lists the export sections with their default opt-in state (R-EXP-1)', async () => {
    await seedPlan();
    await renderTransfer();

    await waitFor(() => expect(screen.getByText('Share a copy')).toBeTruthy());
    for (const section of ['Household', 'Checklist', 'Destination', 'Go-bags']) {
      expect(screen.getByLabelText(section)).toBeTruthy();
    }
    const medical = screen.getByLabelText('Medical plan');
    expect(medical.props.accessibilityState.checked).toBe(false);
    expect(screen.getByText('The file carries everything you picked, including medical details. Share it thoughtfully.')).toBeTruthy();
  });

  it('exports the picked sections through the share sheet and reports failure (R-EXP-8)', async () => {
    await seedPlan();
    await renderTransfer();

    await waitFor(() => expect(screen.getByText('Create the file')).toBeTruthy());
    shareEnvelope.mockResolvedValueOnce(true);
    await fireEvent.press(screen.getByText('Create the file'));
    await waitFor(() => expect(shareEnvelope).toHaveBeenCalledTimes(1));

    const sent = shareEnvelope.mock.calls[0][0] as PlanEnvelope;
    expect(sent.format).toBe('stormready-plan');
    expect(sent.sections.medical).toBeUndefined();

    shareEnvelope.mockResolvedValueOnce(false);
    await fireEvent.press(screen.getByText('Create the file'));
    await waitFor(() => expect(screen.getByText('Sharing is unavailable on this device.')).toBeTruthy());
  });

  it('shows a preview before anything is merged and reports the result (R-EXP-3)', async () => {
    await seedPlan();
    await renderTransfer();

    await waitFor(() => expect(screen.getByText('Import a plan')).toBeTruthy());
    pickPlanFile.mockResolvedValueOnce({ ok: true, envelope: envelopeFor() });
    await fireEvent.press(screen.getByText('Choose a file'));

    await waitFor(() => expect(screen.getByText('What would change')).toBeTruthy());
    expect(screen.getByText('New: 1 parts')).toBeTruthy();
    expect(screen.getByText(/Go-bags — 1 items/)).toBeTruthy();

    await fireEvent.press(screen.getByText('Merge'));
    await waitFor(() => expect(screen.getByText('Import complete')).toBeTruthy());
    expect(screen.getByText('1 parts added · 0 parts merged over existing content · 4 parts skipped')).toBeTruthy();
  });

  it('says clearly when a file was cancelled or unreadable (R-EXP-6)', async () => {
    await seedPlan();
    await renderTransfer();

    await waitFor(() => expect(screen.getByText('Choose a file')).toBeTruthy());
    pickPlanFile.mockResolvedValueOnce({ ok: 'cancelled' });
    await fireEvent.press(screen.getByText('Choose a file'));
    expect(screen.queryByText('What would change')).toBeNull();

    pickPlanFile.mockResolvedValueOnce({ ok: false, reason: 'That file is not a readable StormReady plan.' });
    await fireEvent.press(screen.getByText('Choose a file'));
    await waitFor(() => expect(screen.getByText('That file is not a readable StormReady plan.')).toBeTruthy());
  });

  it('reports a failed export through the generic message (R-EXP-10)', async () => {
    await seedPlan();
    await renderTransfer();

    await waitFor(() => expect(screen.getByText('Create the file')).toBeTruthy());
    shareEnvelope.mockRejectedValueOnce(new Error('boom'));
    await fireEvent.press(screen.getByText('Create the file'));
    await waitFor(() => expect(screen.getByText('The file could not be created. Try again with fewer sections.')).toBeTruthy());
  });

  it('keeps the how-it-works note visible', async () => {
    await seedPlan();
    await renderTransfer();

    await waitFor(() => expect(screen.getByText('How transfer works')).toBeTruthy());
    expect(screen.getByText('QR transfer stays on the two screens — no account or server is involved.')).toBeTruthy();
  });
});
