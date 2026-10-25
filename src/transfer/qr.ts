import type { PlanEnvelope } from './model';

const PREFIX = 'SRP1';
const CHUNK_SIZE = 500;
const MAX_PARTS = 180;

export type TransferQrFrame = {
  sessionId: string;
  index: number;
  total: number;
  chunk: string;
};

/** Splits the ordinary transfer envelope into camera-readable QR frames. */
export function makeTransferQrFrames(envelope: PlanEnvelope, sessionId: string): string[] {
  const characters = Array.from(JSON.stringify(envelope));
  const chunks: string[] = [];
  for (let offset = 0; offset < characters.length; offset += CHUNK_SIZE) {
    chunks.push(characters.slice(offset, offset + CHUNK_SIZE).join(''));
  }
  if (chunks.length > MAX_PARTS) throw new Error('This plan is too large to share by QR code. Use the plan file instead.');
  return chunks.map((chunk, index) => `${PREFIX}:${sessionId}:${index + 1}:${chunks.length}:${chunk}`);
}

/** Returns null for unrelated QR codes so the scanner can ignore them. */
export function parseTransferQrFrame(value: string): TransferQrFrame | null {
  const [prefix, sessionId, rawIndex, rawTotal, chunk] = value.split(':', 5);
  if (prefix !== PREFIX || !sessionId || !/^[a-z\d-]{1,80}$/i.test(sessionId) || !chunk || Array.from(chunk).length > CHUNK_SIZE) return null;
  const index = Number(rawIndex);
  const total = Number(rawTotal);
  if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || total > MAX_PARTS || index < 1 || index > total) return null;
  return { sessionId, index, total, chunk };
}

/** Reassembles a complete transfer after all numbered frames have arrived. */
export function assembleTransferQrFrames(frames: Map<number, string>, total: number): string | null {
  if (frames.size !== total) return null;
  let result = '';
  for (let index = 1; index <= total; index += 1) {
    const chunk = frames.get(index);
    if (chunk === undefined) return null;
    result += chunk;
  }
  return result;
}
