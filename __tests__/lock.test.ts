import { Platform } from 'react-native';

import {
  PIN_STORAGE_KEY,
  clearPin,
  isFourDigits,
  pinSupported,
  pinsMatch,
  readPin,
  writePin,
} from '../src/privacy/lock';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => '9274'),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

const SecureStore = jest.requireMock('expo-secure-store') as {
  getItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
};

const originalPlatform = Platform.OS;

beforeEach(() => {
  jest.clearAllMocks();
  (Platform as { OS: string }).OS = originalPlatform;
  SecureStore.getItemAsync.mockResolvedValue('9274');
});

afterAll(() => {
  (Platform as { OS: string }).OS = originalPlatform;
});

describe('pinSupported (R-WIP-3)', () => {
  it('is native-only', () => {
    expect(pinSupported()).toBe(true);
    (Platform as { OS: string }).OS = 'web';
    expect(pinSupported()).toBe(false);
  });
});

describe('readPin', () => {
  it('reads the stored PIN from the one storage key', async () => {
    await expect(readPin()).resolves.toBe('9274');
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith(PIN_STORAGE_KEY);
  });

  it('returns null for an empty stored value', async () => {
    SecureStore.getItemAsync.mockResolvedValueOnce('');
    await expect(readPin()).resolves.toBeNull();
  });

  it('returns null when the keystore throws instead of crashing', async () => {
    SecureStore.getItemAsync.mockRejectedValueOnce(new Error('keystore locked'));
    await expect(readPin()).resolves.toBeNull();
  });

  it('never touches the store on web', async () => {
    (Platform as { OS: string }).OS = 'web';
    await expect(readPin()).resolves.toBeNull();
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
  });
});

describe('writePin / clearPin', () => {
  it('stores and deletes under the same key', async () => {
    await writePin('1234');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(PIN_STORAGE_KEY, '1234');

    await clearPin();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(PIN_STORAGE_KEY);
  });

  it('is a no-op on web', async () => {
    (Platform as { OS: string }).OS = 'web';
    await writePin('1234');
    await clearPin();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('treats a failing delete as done', async () => {
    SecureStore.deleteItemAsync.mockRejectedValueOnce(new Error('already gone'));
    await expect(clearPin()).resolves.toBeUndefined();
  });
});

describe('isFourDigits / pinsMatch', () => {
  it('accepts exactly four digits and nothing else', () => {
    for (const value of ['0000', '9999', '1234']) {
      expect(isFourDigits(value)).toBe(true);
    }
    for (const value of ['', '123', '12345', '12a4', '12 4', '-123']) {
      expect(isFourDigits(value)).toBe(false);
    }
  });

  it('compares the trimmed entry against the stored value', () => {
    expect(pinsMatch('9274', '9274')).toBe(true);
    expect(pinsMatch('9274', ' 9274 ')).toBe(true);
    expect(pinsMatch('9274', '9275')).toBe(false);
    expect(pinsMatch(null, '9274')).toBe(false);
    expect(pinsMatch('', '9274')).toBe(false);
  });
});
