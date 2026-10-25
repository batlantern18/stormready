import { clampInventoryEntry, type InventoryEntry, type InventoryState } from '../plan-schema';

/**
 * F01 — Kit Inventory & Expiry Tracker (pure).
 *
 * Inventory is the user's own tracking of what they own (R-INV-5). It never
 * changes the calculated kit; the UI shows the two side by side. Coverage is
 * always derived from `calculateKit` output (R-INV-4) and never stored.
 */

export const EXPIRING_SOON_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

export type CoverageLine = {
  itemId: 'water' | 'food';
  unit: 'gal' | 'person-day';
  required: number;
  owned: number;
  shortfall: number;
  /** 0–100, or null when the requirement itself is 0. */
  percent: number | null;
  covered: boolean;
};

export function entryFor(inventory: InventoryState, itemId: string): InventoryEntry | null {
  const entry = inventory.entries[itemId];
  return entry ? clampInventoryEntry(entry) : null;
}

export function upsertEntry(
  entries: Record<string, InventoryEntry>,
  entry: InventoryEntry,
): Record<string, InventoryEntry> {
  const clean = clampInventoryEntry(entry);
  if (!clean.itemId) return entries;
  return { ...entries, [clean.itemId]: clean };
}

export function removeEntry(
  entries: Record<string, InventoryEntry>,
  itemId: string,
): Record<string, InventoryEntry> {
  const next = { ...entries };
  delete next[itemId];
  return next;
}

/**
 * Coverage for the two focus quantities (water in gallons, food in
 * person-days). Over-coverage is reported as `covered`, never as an error
 * (R-INV-11): percent is capped at 100 in `covered` state.
 */
export function coverageFor(
  lines: { id: string; quantity: number; unit: string }[],
  inventory: InventoryState,
): CoverageLine[] {
  const result: CoverageLine[] = [];
  for (const itemId of ['water', 'food'] as const) {
    const line = lines.find(candidate => candidate.id === itemId);
    const entry = entryFor(inventory, itemId);
    const required = line && Number.isFinite(line.quantity) ? line.quantity : 0;
    const owned = entry && entry.owned ? entry.quantityOwned : 0;
    const rawPercent = required > 0 ? Math.round((owned / required) * 100) : null;
    const covered = rawPercent !== null && rawPercent >= 100;
    result.push({
      itemId,
      unit: itemId === 'water' ? 'gal' : 'person-day',
      required,
      owned,
      shortfall: Math.max(0, required - owned),
      percent: covered ? 100 : rawPercent,
      covered,
    });
  }
  return result;
}

/** Owned items expiring within `days` (boundary: day 60 in, day 61 out). */
export function expiringItems(
  entries: Record<string, InventoryEntry>,
  now: Date,
  days = EXPIRING_SOON_DAYS,
): InventoryEntry[] {
  const nowMs = now.getTime();
  return Object.values(entries)
    .filter(entry => entry.owned && entry.expiresAt)
    .filter(entry => {
      const expires = new Date(entry.expiresAt ?? '').getTime();
      if (Number.isNaN(expires)) return false;
      const diff = expires - nowMs;
      return diff >= 0 && diff <= days * DAY_MS;
    });
}

/** Owned items past their expiry date. They never disappear silently. */
export function expiredItems(
  entries: Record<string, InventoryEntry>,
  now: Date,
): InventoryEntry[] {
  const nowMs = now.getTime();
  return Object.values(entries)
    .filter(entry => entry.owned && entry.expiresAt)
    .filter(entry => {
      const expires = new Date(entry.expiresAt ?? '').getTime();
      return !Number.isNaN(expires) && expires < nowMs;
    });
}

/**
 * R-INV-1: when a catalog item leaves the kit, its inventory entry survives
 * as an orphan and is shown in a "no longer in your kit" list until the user
 * removes it explicitly.
 */
export function orphanEntries(
  entries: Record<string, InventoryEntry>,
  lineIds: string[],
): InventoryEntry[] {
  const known = new Set(lineIds);
  return Object.values(entries).filter(entry => !known.has(entry.itemId));
}

/**
 * R-INV-9: "Start rotating" stamps `purchasedAt` to today for the given item
 * ids (water and food) when they have no date, and does nothing for entries
 * that already have one.
 */
export function stampRotation(
  entries: Record<string, InventoryEntry>,
  itemIds: string[],
  nowIso: string,
): InventoryState {
  let touched = false;
  const nextEntries = { ...entries };
  for (const itemId of itemIds) {
    const entry = entryFor({ entries: nextEntries, lastRotationAt: null }, itemId);
    const base: InventoryEntry = entry ?? {
      itemId,
      owned: true,
      quantityOwned: 0,
      purchasedAt: null,
      expiresAt: null,
      note: '',
    };
    if (!entry) {
      touched = true;
      nextEntries[itemId] = { ...base, purchasedAt: nowIso };
      continue;
    }
    if (!entry.purchasedAt) {
      touched = true;
      nextEntries[itemId] = { ...entry, purchasedAt: nowIso };
    }
  }
  return {
    entries: nextEntries,
    lastRotationAt: touched ? nowIso : null,
  };
}

export function countTracked(entries: Record<string, InventoryEntry>): number {
  return Object.values(entries).length;
}
