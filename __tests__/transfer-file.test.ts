import * as DocumentPicker from 'expo-document-picker';

import {
  deleteExportFile,
  pickPlanFile,
  shareEnvelope,
} from '../src/transfer/file';
import type { PlanEnvelope } from '../src/transfer/model';

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => {}),
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/cache/',
  EncodingType: { UTF8: 'utf8' },
  writeAsStringAsync: jest.fn(async () => {}),
  readAsStringAsync: jest.fn(async () => ''),
  deleteAsync: jest.fn(async () => {}),
}));

const Sharing = jest.requireMock('expo-sharing') as {
  isAvailableAsync: jest.Mock;
  shareAsync: jest.Mock;
};

const Picker = jest.requireMock('expo-document-picker') as {
  getDocumentAsync: jest.Mock;
};

const FileSystem = jest.requireMock('expo-file-system/legacy') as {
  writeAsStringAsync: jest.Mock;
  readAsStringAsync: jest.Mock;
  deleteAsync: jest.Mock;
};

const envelope: PlanEnvelope = {
  format: 'stormready-plan',
  version: 1,
  planId: 'plan-1',
  exportedAt: '2026-10-20T12:00:00.000Z',
  sections: {},
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('shareEnvelope (R-EXP-7/8)', () => {
  it('writes one local JSON file and hands it to the share sheet, no network', async () => {
    await expect(shareEnvelope(envelope)).resolves.toBe(true);

    const [uri, contents] = FileSystem.writeAsStringAsync.mock.calls[0];
    expect(uri).toBe('/cache/stormready-plan-2026-10-20T12-00-00.stormready-plan');
    expect(JSON.parse(contents)).toEqual(envelope);
    expect(Sharing.shareAsync).toHaveBeenCalledWith(uri, expect.objectContaining({
      mimeType: 'application/json',
      dialogTitle: 'StormReady plan',
    }));
  });

  it('reports an unavailable share sheet without writing anything', async () => {
    Sharing.isAvailableAsync.mockResolvedValueOnce(false);

    await expect(shareEnvelope(envelope)).resolves.toBe(false);
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });
});

describe('pickPlanFile (R-EXP-6)', () => {
  it('reports a cancellation without touching the plan', async () => {
    Picker.getDocumentAsync.mockResolvedValueOnce({ canceled: true, assets: [] });

    await expect(pickPlanFile()).resolves.toEqual({ ok: 'cancelled' });
  });

  it('reports an unreadable pick (no asset) without crashing', async () => {
    Picker.getDocumentAsync.mockResolvedValueOnce({ canceled: false, assets: [] });

    const result = await pickPlanFile();
    expect(result).toMatchObject({ ok: false });
    expect(typeof (result as { reason: string }).reason).toBe('string');
  });

  it('rejects files that are not valid JSON or not a StormReady plan', async () => {
    Picker.getDocumentAsync.mockResolvedValueOnce({ canceled: false, assets: [{ uri: '/picked/not-json' }] });
    FileSystem.readAsStringAsync.mockResolvedValueOnce('{ not json');

    const bad = await pickPlanFile();
    expect(bad).toMatchObject({ ok: false, reason: 'That file is not a readable StormReady plan.' });

    Picker.getDocumentAsync.mockResolvedValueOnce({ canceled: false, assets: [{ uri: '/picked/other.json' }] });
    FileSystem.readAsStringAsync.mockResolvedValueOnce(JSON.stringify({ hello: true }));

    const stranger = await pickPlanFile();
    expect(stranger).toMatchObject({ ok: false, reason: 'That file is not a StormReady plan.' });

    Picker.getDocumentAsync.mockResolvedValueOnce({ canceled: false, assets: [{ uri: '/picked/newer.json' }] });
    FileSystem.readAsStringAsync.mockResolvedValueOnce(JSON.stringify({ ...envelope, version: 99 }));

    const newer = await pickPlanFile();
    expect(newer).toMatchObject({ ok: false, reason: expect.stringContaining('newer app version') });
  });

  it('reads a self-contained plan file back into an envelope', async () => {
    Picker.getDocumentAsync.mockResolvedValueOnce({ canceled: false, assets: [{ uri: '/picked/plan.json' }] });
    FileSystem.readAsStringAsync.mockResolvedValueOnce(JSON.stringify(envelope));

    const result = await pickPlanFile();
    expect(result).toMatchObject({ ok: true, envelope: { planId: 'plan-1', exportedAt: envelope.exportedAt } });
  });

  it('survives a picker crash as a cancellation, not an error page', async () => {
    Picker.getDocumentAsync.mockRejectedValueOnce(new Error('cannot open picker'));

    await expect(pickPlanFile()).resolves.toEqual({ ok: 'cancelled' });
  });
});

describe('deleteExportFile', () => {
  it('removes temp exports idempotently', async () => {
    await deleteExportFile('/cache/stormready-plan-1.stormready-plan');
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('/cache/stormready-plan-1.stormready-plan', { idempotent: true });
  });
});
