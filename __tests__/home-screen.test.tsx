import React from 'react';
import { screen } from '@testing-library/react-native';

import Home from '../src/app/(tabs)/index';
import { renderWithPlan } from './helpers/app';

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

describe('Home screen', () => {
  it('shows the plan progress and the next step', async () => {
    await renderWithPlan(<Home />);

    expect(screen.getByText('STORMREADY')).toBeTruthy();
    expect(screen.getByText('SAVED ON DEVICE')).toBeTruthy();
    expect(screen.getByText('Ready starts with one small step.')).toBeTruthy();
    expect(screen.getByText('UP NEXT')).toBeTruthy();
    expect(screen.getByText('Set aside drinking water')).toBeTruthy();
  });

  it('states that the app is not an alert authority', async () => {
    await renderWithPlan(<Home />);

    expect(screen.getByText('For current alerts, check official sources')).toBeTruthy();
  });
});
