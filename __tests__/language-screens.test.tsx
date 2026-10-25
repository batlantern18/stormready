import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import Language from '../src/app/settings/language';
import LanguageStep from '../src/app/onboarding/language';
import { PlanProvider } from '../src/plan';
import { ThemeProvider } from '../src/theme';

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

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('language screen (F10, R-L10-3)', () => {
  it('offers system, English, and Spanish with the current pick marked', async () => {
    await render(
      <ThemeProvider>
        <PlanProvider>
          <Language />
        </PlanProvider>
      </ThemeProvider>,
    );

    await waitFor(() => expect(screen.getByText('The same plan, in whichever language the household needs.')).toBeTruthy());
    expect(screen.getByText('◉ Follow the system')).toBeTruthy();
    expect(screen.getByText('○ English')).toBeTruthy();
    expect(screen.getByText('○ Español')).toBeTruthy();
    expect(screen.getAllByText('In use').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/English: March 2, 2026 · Spanish: 2 de marzo de 2026/)).toBeTruthy();
    expect(screen.getByText('Spanish is complete across the app. Shared cards and exported files stay close to their sources, and a few screens from v1.1 still carry English copy.')).toBeTruthy();
  });

  it('applies a choice immediately without a restart', async () => {
    await render(
      <ThemeProvider>
        <PlanProvider>
          <Language />
        </PlanProvider>
      </ThemeProvider>,
    );

    await waitFor(() => expect(screen.getByText('○ Español')).toBeTruthy());
    await fireEvent.press(screen.getByText('○ Español'));

    // The locale preference lives in the theme document (R-L10-3).
    await waitFor(async () => {
      const themeDoc = JSON.parse((await AsyncStorage.getItem('stormready.theme.v2')) ?? '{}');
      expect(themeDoc?.data?.locale).toBe('es');
    });
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});

describe('onboarding language step (F10)', () => {
  it('appears with the one-time explanation and both choices', async () => {
    await render(
      <PlanProvider>
        <LanguageStep />
      </PlanProvider>,
    );

    await waitFor(() => expect(screen.getByText('Your household decides the language')).toBeTruthy());
    expect(screen.getByText('StormReady speaks Spanish')).toBeTruthy();
    expect(screen.getByText('Choose English')).toBeTruthy();
    expect(screen.getByText('Elegir español')).toBeTruthy();
    expect(screen.getByText('You can always switch in Settings → Language.')).toBeTruthy();
  });

  it('jumps straight to the household step after a choice', async () => {
    await render(
      <PlanProvider>
        <LanguageStep />
      </PlanProvider>,
    );

    await waitFor(() => expect(screen.getByText('Choose English')).toBeTruthy());
    await fireEvent.press(screen.getByText('Choose English'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/onboarding/household');
  });
});
