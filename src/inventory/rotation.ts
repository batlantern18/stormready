import type { InventoryEntry } from '../plan-schema';

/**
 * F01 — rotation math (pure). Dates come from the user's own entries and the
 * catalog's optional `shelfLifeMonths`; nothing here invents a due date.
 */

function addMonths(iso: string, months: number): Date | null {
  const base = new Date(iso);
  if (Number.isNaN(base.getTime())) return null;
  const rotated = new Date(base.getTime());
  rotated.setMonth(rotated.getMonth() + months);
  return rotated;
}

/** When an entry should next be rotated, or null when unknowable. */
export function rotationDateFor(entry: InventoryEntry, shelfLifeMonths?: number): Date | null {
  if (!shelfLifeMonths || shelfLifeMonths <= 0 || !entry.purchasedAt) return null;
  const date = addMonths(entry.purchasedAt, shelfLifeMonths);
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

export type RotationDue = {
  itemId: string;
  dueAt: string;
  overdue: boolean;
};

/**
 * The earliest upcoming rotation date from a shelf-life lookup, e.g.
 * `shelfLifeFor = itemId => catalogItem(itemId)?.shelfLifeMonths`.
 */
export function nextRotation(
  entries: Record<string, InventoryEntry>,
  shelfLifeFor: (itemId: string) => number | undefined,
  now: Date,
): RotationDue | null {
  let earliest: RotationDue | null = null;
  for (const entry of Object.values(entries)) {
    const due = rotationDateFor(entry, shelfLifeFor(entry.itemId));
    if (!due) continue;
    const candidate: RotationDue = {
      itemId: entry.itemId,
      dueAt: due.toISOString(),
      overdue: due.getTime() < now.getTime(),
    };
    if (
      !earliest ||
      (candidate.overdue === earliest.overdue && candidate.dueAt < earliest.dueAt) ||
      (candidate.overdue && !earliest.overdue)
    ) {
      earliest = candidate;
    }
  }
  return earliest;
}

/** Any owned entry whose rotation date has passed (drives the reminder copy). */
export function isRotationDue(
  entries: Record<string, InventoryEntry>,
  shelfLifeFor: (itemId: string) => number | undefined,
  now: Date,
): boolean {
  const next = nextRotation(entries, shelfLifeFor, now);
  return Boolean(next?.overdue);
}

export type { InventoryEntry };
