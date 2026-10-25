import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import Readiness from '../src/app/readiness';
import { DEFAULT_COMMUNICATION_PLAN, DEFAULT_PROFILE_PLAN, DEFAULT_TASKS } from '../src/plan-schema';
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
  useSegments: () => ['readiness'],
  useLocalSearchParams: () => ({}),
  Link: ({ children }: { children: React.ReactNode }) => children,
  Redirect: () => null,
}));

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  const mock = jest.requireActual('react-native-safe-area-context/jest/mock').default;
  return { ...actual, ...mock, default: mock };
});

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

async function renderReadiness() {
  return render(
    <PlanProvider>
      <Readiness />
    </PlanProvider>,
  );
}

beforeEach(async () => {
  __resetStorageStateForTests();
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

const FACTOR_LABELS = [
  'Checklist progress',
  'Have what you need',
  'Dates current',
  'Zone verified',
  'Go-bags packed',
  'Communication plan',
  'Medical plan',
  'Practice',
  'Kit review recency',
];

const BASE_MEDICAL = {
  medications: [{ id: 'med-1', name: 'Insulin', dose: '10 units', schedule: '', days: 14, refrigerated: true, prescriptionRefillDate: '2026-11-05', pharmacy: '', notes: '' }],
  devices: [],
  contacts: [],
  allergies: '',
  notes: '',
};

describe('readiness screen (F09)', () => {
  it('leads with the score, the band, and an honest framing', async () => {
    await seedPlan();
    await renderReadiness();

    await waitFor(() => expect(screen.getByText('How ready are you?')).toBeTruthy());
    expect(screen.getByText('out of 100')).toBeTruthy();
    expect(screen.getByText("The estimate moves as your plan and kit move. It is a reflection, not a grade.")).toBeTruthy();
    expect(screen.getByText('The nine factors')).toBeTruthy();
  });

  it('breaks the score into the nine named factors', async () => {
    // The expiry and medical factors only join the list once there is
    // something to look at, so seed both.
    await seedPlan({
      medical: BASE_MEDICAL,
      inventory: {
        entries: {
          water: { itemId: 'water', owned: true, quantityOwned: 1, purchasedAt: '2026-09-15', expiresAt: null, note: '' },
        },
        lastRotationAt: '2026-10-01T00:00:00.000Z',
      },
    });
    await renderReadiness();

    await waitFor(() => expect(screen.getByText('The nine factors')).toBeTruthy());
    for (const label of FACTOR_LABELS) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('lists the top gaps first with the fix route (R-RDY-4)', async () => {
    await seedPlan();
    await renderReadiness();

    await waitFor(() => expect(screen.getByText('Where to start')).toBeTruthy());
    const fixes = screen.getAllByText('Go here');
    expect(fixes.length).toBeGreaterThanOrEqual(1);

    await fireEvent.press(fixes[0]);
    expect(mockRouter.push).toHaveBeenCalled();
  });

  it('shows the hurricane-season card for a US/FL household in season', async () => {
    await seedPlan({ household: { ...DEFAULT_PROFILE_PLAN.household, country: 'US', state: 'FL' } });
    await renderReadiness();

    // October is inside the Atlantic hurricane season (June 1 – Nov 30).
    await waitFor(() => expect(screen.getByText('Hurricane season')).toBeTruthy());
    expect(screen.getByText('Review my kit')).toBeTruthy();
    await fireEvent.press(screen.getByText('Review my kit'));
    expect(mockRouter.push).toHaveBeenCalledWith('/inventory');
  });

  it('praises the all-clear state when every factor is worked', async () => {
    // The seed mirrors the "maxes out every factor" fixture from the
    // readiness model unit tests, so the screen renders its no-gaps state.
    await seedPlan({
      tasks: DEFAULT_TASKS.map(task => ({ ...task, done: true })),
      inventory: {
        entries: {
          water: { itemId: 'water', owned: true, quantityOwned: 14, purchasedAt: null, expiresAt: null, note: '' },
          food: { itemId: 'food', owned: true, quantityOwned: 14, purchasedAt: null, expiresAt: null, note: '' },
        },
        lastRotationAt: '2026-10-19T12:00:00.000Z',
      },
      zone: { value: 'Zone C', source: 'manual', county: '', verifiedAt: '2026-10-19T12:00:00.000Z', notes: '', sourceUrl: '', country: 'US' },
      goBags: { bags: [{
        id: 'bag-1', name: 'Personal go-bag', owner: '', location: '', template: 'personal',
        itemIds: ['water', 'food'], packed: { water: true, food: true }, note: '', createdAt: '',
      }] },
      communication: {
        ...DEFAULT_COMMUNICATION_PLAN,
        contacts: [{ id: 'con-1', name: 'Ana', phone: '', relationship: '', distance: '' }],
        meetingPoint: { label: 'Publix', address: '500 5th', note: '' },
        checkIn: { who: 'Ben', everyHours: 24, method: 'text', fallback: '' },
        backup: { contact: 'Ana', method: '', note: '' },
      },
      drills: { results: [{ id: 'dr-1', drillId: 'power-outage', completedAt: '2026-10-19T12:00:00.000Z', durationSeconds: 60, answers: {}, suggestedTasks: [] }] },
    });
    await renderReadiness();

    await waitFor(() => expect(screen.getByText('Every factor is worked')).toBeTruthy());
    expect(screen.getByText('The next useful step is practising: run a drill and keep the dates fresh.')).toBeTruthy();
    expect(screen.queryByText('Where to start')).toBeNull();
  });
});
