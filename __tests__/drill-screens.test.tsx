import React from 'react';
import { Alert, Share } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import DrillList from '../src/app/drill';
import DrillRun from '../src/app/drill/[id]';
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

const mockParams: { id?: string } = { id: 'power-outage' };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useSegments: () => ['drill'],
  useLocalSearchParams: () => ({ ...mockParams }),
  Link: ({ children }: { children: React.ReactNode }) => children,
  Redirect: () => null,
}));

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  const mock = jest.requireActual('react-native-safe-area-context/jest/mock').default;
  return { ...actual, ...mock, default: mock };
});

const DRILL_RESULT = {
  id: 'dr-1',
  drillId: 'power-outage',
  completedAt: '2026-10-19T12:00:00.000Z',
  durationSeconds: 320,
  answers: { lights: 'ready', radio: 'ready', devices: 'not-yet', fridge: 'ready', 'cold-medication': 'skipped', neighbour: 'ready' },
  suggestedTasks: [],
};

async function seedPlan(profile: Record<string, unknown> = {}) {
  await AsyncStorage.setItem(keys.plan.key, JSON.stringify({
    version: keys.plan.version,
    savedAt: '2026-10-19T12:00:00.000Z',
    data: {
      onboarded: true,
      activeProfileId: 'default',
      profiles: { default: { ...DEFAULT_PROFILE_PLAN, ...profile } },
      updatedAt: '2026-10-19T12:00:00.000Z',
    },
  }));
}

async function renderDrillList() {
  return render(
    <PlanProvider>
      <DrillList />
    </PlanProvider>,
  );
}

async function renderDrillRun() {
  return render(
    <PlanProvider>
      <DrillRun />
    </PlanProvider>,
  );
}

beforeEach(async () => {
  __resetStorageStateForTests();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockParams.id = 'power-outage';
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('drills list screen (F08)', () => {
  it('lists the five shipped scenarios with lengths and the gentle disclaimer', async () => {
    await seedPlan();
    await renderDrillList();

    await waitFor(() => expect(screen.getByText('Five scenarios')).toBeTruthy());
    for (const name of ['Power outage', 'Evacuation walk', 'Shelter in place', 'Home medical hour', 'Phones down']) {
      expect(screen.getByText(name)).toBeTruthy();
    }
    expect(screen.getByText('Never drilled')).toBeTruthy();
    expect(screen.getAllByText(/Leaving or staying in a real event remains a decision made with local guidance/).length).toBeGreaterThanOrEqual(1);
  });

  it('opens a scenario from its card', async () => {
    await seedPlan();
    await renderDrillList();

    const starts = await screen.findAllByText('Start drill');
    await fireEvent.press(starts[0]);
    expect(mockRouter.push).toHaveBeenCalledWith('/drill/power-outage');
  });

  it('keeps a practice history and a due nudge after 60 idle days (R-DRL-3)', async () => {
    await seedPlan({ drills: { results: [DRILL_RESULT] } });
    await renderDrillList();

    await waitFor(() => expect(screen.getByText('Recent drills')).toBeTruthy());
    expect(screen.getByText('Power outage · Oct 19, 2026')).toBeTruthy();
    expect(screen.getByText('4/6 ready · 1 to work on')).toBeTruthy();
  });
});

describe('drill runner screen (F08, R-DRL-2/3/4)', () => {
  it('walks one step per screen with a local silent countdown', async () => {
    await seedPlan();
    await renderDrillRun();

    await waitFor(() => expect(screen.getByText('Step 1 of 6')).toBeTruthy());
    expect(screen.getByText(/Do you know where every flashlight is right now/)).toBeTruthy();

    await fireEvent.press(screen.getByText('Ready'));
    await waitFor(() => expect(screen.getByText('Step 2 of 6')).toBeTruthy());
    expect(screen.getByText(/Can you get news without power or cell service/)).toBeTruthy();
  });

  it('offers an optional checklist task for a “not yet” answer (R-DRL-2)', async () => {
    await seedPlan();
    await renderDrillRun();

    await waitFor(() => expect(screen.getByText('Step 1 of 6')).toBeTruthy());
    await fireEvent.press(screen.getByText('Not yet'));

    await waitFor(() => expect(screen.getByText('Turn this into a task?')).toBeTruthy());
    await fireEvent.press(screen.getByText('Add to checklist'));

    await waitFor(() => expect(screen.getByText('Step 2 of 6')).toBeTruthy());
    await waitFor(async () => {
      const doc = JSON.parse((await AsyncStorage.getItem(keys.plan.key)) ?? '{}');
      const tasks = doc?.data?.profiles?.default?.tasks ?? [];
      expect(tasks.some((task: { title?: string }) => task.title === 'Set one flashlight spot')).toBe(true);
    });
  });

  it('reaches the debrief, and saving is local and explicit (R-DRL-5)', async () => {
    await seedPlan();
    await renderDrillRun();

    for (let step = 2; step <= 6; step += 1) {
      await fireEvent.press(await screen.findByText('Ready'));
      await waitFor(() => expect(screen.getByText(`Step ${step} of 6`)).toBeTruthy());
    }
    await fireEvent.press(screen.getByText('Ready'));

    await waitFor(() => expect(screen.getByText('How did it go?')).toBeTruthy());
    expect(screen.getByText('6/6 ready')).toBeTruthy();

    await fireEvent.press(screen.getByText('Save this result'));
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy());

    await waitFor(async () => {
      const doc = JSON.parse((await AsyncStorage.getItem(keys.plan.key)) ?? '{}');
      expect(doc?.data?.profiles?.default?.drills?.results ?? []).toHaveLength(1);
    });
  });

  it('answers honestly, then shares instead of saving', async () => {
    await seedPlan();
    await renderDrillRun();

    await waitFor(() => expect(screen.getByText('Step 1 of 6')).toBeTruthy());
    await fireEvent.press(screen.getByText('Not yet'));
    await fireEvent.press(await screen.findByText('No thanks'));

    // 'No thanks' already advanced to Step 2.
    for (let step = 3; step <= 6; step += 1) {
      await fireEvent.press(await screen.findByText('Ready'));
      await waitFor(() => expect(screen.getByText(`Step ${step} of 6`)).toBeTruthy());
    }
    await fireEvent.press(screen.getByText('Ready'));

    await waitFor(() => expect(screen.getByText('5/6 ready')).toBeTruthy());
    await fireEvent.press(screen.getByText('Share instead'));
    await waitFor(() => expect(Share.share).toHaveBeenCalled());
    const message = (Share.share as jest.Mock).mock.calls[0][0].message as string;
    expect(message).toContain('5/6 ready');
  });

  it('catches an unknown scenario id with a way back', async () => {
    mockParams.id = 'not-a-drill';
    await renderDrillRun();

    await waitFor(() => expect(screen.getByText('Which drill?')).toBeTruthy());
    await fireEvent.press(screen.getByText('Drills list'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/drill');
  });
});
