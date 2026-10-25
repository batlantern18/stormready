import React from 'react';
import { render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { PlanProvider } from '../../src/plan';
import { DEFAULT_PROFILE_ID, DEFAULT_PROFILE_PLAN, DEFAULT_TASKS } from '../../src/plan-schema';
import { keys } from '../../src/storage/keys';

export const DEFAULT_HOUSEHOLD = {
  people: 2,
  infants: 0,
  days: 7,
  pets: false,
  petCount: 0,
  hasVehicle: true,
  medicalNeeds: false,
  county: 'Hillsborough County',
  accessibilityNeeds: false,
  country: 'US' as const,
  state: 'FL',
};

export const DEFAULT_ZONE = {
  value: 'Zone C',
  source: 'manual' as const,
  county: 'Hillsborough County',
  verifiedAt: '2026-10-19T12:00:00.000Z',
  notes: '',
  sourceUrl: '',
  country: 'US' as const,
};

/** Writes a saved plan so the provider hydrates from a stored document. */
export async function seedPlan(
  household: Record<string, unknown> = DEFAULT_HOUSEHOLD,
  zone: Record<string, unknown> = DEFAULT_ZONE,
) {
  await AsyncStorage.setItem(keys.plan.key, JSON.stringify({
    version: keys.plan.version,
    savedAt: '2026-10-19T12:00:00.000Z',
    data: {
      onboarded: true,
      activeProfileId: DEFAULT_PROFILE_ID,
      // The default profile carries every v1.2 section so screens see complete
      // objects the way a migrated v1.1 document does.
      profiles: {
        [DEFAULT_PROFILE_ID]: {
          ...DEFAULT_PROFILE_PLAN,
          household,
          zone,
          destination: { label: '', address: '', transport: '' },
          tasks: DEFAULT_TASKS,
        },
      },
      updatedAt: '2026-10-19T12:00:00.000Z',
    },
  }));
}

/** Renders a screen inside the plan provider. */
export async function renderWithPlan(node: React.ReactNode) {
  await seedPlan();
  return render(<PlanProvider>{node}</PlanProvider>);
}
