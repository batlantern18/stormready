import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';

import Prepare from '../src/app/(tabs)/plan';
import { renderWithPlan } from './helpers/app';

const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
  dismissTo: jest.fn(),
  navigate: jest.fn(),
};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
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

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Prepare screen', () => {
  it('shows the household details that size the plan', async () => {
    await renderWithPlan(<Prepare />);

    expect(screen.getByText('Make room for peace of mind.')).toBeTruthy();
    expect(screen.getByDisplayValue('Hillsborough County')).toBeTruthy();
    expect(screen.getByLabelText('People: 2')).toBeTruthy();
    expect(screen.getByLabelText('Days to prepare: 7')).toBeTruthy();
  });

  it('shows the kit sized for the household and a way to open it', async () => {
    await renderWithPlan(<Prepare />);

    expect(screen.getByText('14 gal')).toBeTruthy();
    await fireEvent.press(screen.getByText('Open my emergency kit'));
    expect(mockRouter.push).toHaveBeenCalledWith('/kit');
  });

  it('shows the zone with its provenance', async () => {
    await renderWithPlan(<Prepare />);

    expect(screen.getByText('Zone C')).toBeTruthy();
    expect(screen.getByText(/Entered by you/)).toBeTruthy();
  });

  it('marks a checklist step as done and updates the progress', async () => {
    await renderWithPlan(<Prepare />);

    const task = screen.getByLabelText('Set aside drinking water');
    expect(task.props.accessibilityState.checked).toBe(false);

    await fireEvent.press(task);

    expect(screen.getByLabelText('Set aside drinking water').props.accessibilityState.checked).toBe(true);
    expect(screen.getByText('1 of 5 steps complete')).toBeTruthy();
  });

  it('updates the household from the checklist screen', async () => {
    await renderWithPlan(<Prepare />);

    await fireEvent.press(screen.getByLabelText('Increase People'));
    expect(screen.getByLabelText('People: 3')).toBeTruthy();
  });
});
