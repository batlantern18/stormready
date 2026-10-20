import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import Updates from '../src/app/(tabs)/updates';
import { renderWithPlan } from './helpers/app';
import * as http from '../src/net/http';
import * as Location from 'expo-location';

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
  Accuracy: { Low: 1 },
}));

jest.mock('../src/net/http', () => ({
  httpJson: jest.fn(),
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

const httpJson = http.httpJson as jest.Mock;
const mockLocation = Location as unknown as {
  requestForegroundPermissionsAsync: jest.Mock;
  getCurrentPositionAsync: jest.Mock;
  reverseGeocodeAsync: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
  mockLocation.getCurrentPositionAsync.mockResolvedValue({ coords: { latitude: 27.95, longitude: -82.45 } });
  mockLocation.reverseGeocodeAsync.mockResolvedValue([{ isoCountryCode: 'US' }]);
  httpJson.mockResolvedValue({
    features: [{
      id: 'urn:alert:1',
      properties: {
        event: 'Hurricane Warning',
        headline: 'Take shelter now',
        areaDesc: 'Hillsborough County',
        ends: '2026-10-20T12:00:00.000Z',
        senderName: 'NWS Tampa',
        description: 'Storm conditions expected.',
        instruction: 'Move to a safe room.',
      },
    }],
  });
});

describe('Updates screen', () => {
  it('asks for location only when the user requests a check', async () => {
    await renderWithPlan(<Updates />);
    expect(mockLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('shows the active alerts for the checked location', async () => {
    await renderWithPlan(<Updates />);

    await fireEvent.press(screen.getByText('Check my area'));

    expect(await screen.findByText('Hurricane Warning')).toBeTruthy();
    expect(screen.getByText('Take shelter now')).toBeTruthy();
    expect(screen.getByText(/Hillsborough County/)).toBeTruthy();
    expect(screen.getByText(/NWS Tampa/)).toBeTruthy();
    expect(mockLocation.requestForegroundPermissionsAsync).toHaveBeenCalled();
  });

  it('explains when location permission is refused', async () => {
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await renderWithPlan(<Updates />);

    await fireEvent.press(screen.getByText('Check my area'));

    expect(await screen.findByText(/Location permission is off/)).toBeTruthy();
  });

  it('looks up an address the user typed', async () => {
    httpJson.mockResolvedValueOnce([{ lat: '27.95', lon: '-82.45', address: { country_code: 'us' } }]);
    await renderWithPlan(<Updates />);

    await fireEvent.changeText(screen.getByPlaceholderText('U.S. or Mexico address, city, or postal code'), 'Tampa, FL');
    await fireEvent.press(screen.getByText('Check this address'));

    await waitFor(() => expect(httpJson).toHaveBeenCalled());
    expect(String((httpJson.mock.calls[0] as unknown[])[0])).toContain('nominatim.openstreetmap.org');
  });

  it('points Mexico users at the official sources', async () => {
    mockLocation.reverseGeocodeAsync.mockResolvedValue([{ isoCountryCode: 'MX' }]);
    await renderWithPlan(<Updates />);

    await fireEvent.press(screen.getByText('Check my area'));

    expect(await screen.findByText(/For Mexico, check the official national and local sources/)).toBeTruthy();
  });
});
