import type { GoBag, GoBagTemplate, Household } from '../plan-schema';
import { BAG_TEMPLATES } from './templates';

/**
 * F02 — Go-Bag Builder (pure).
 *
 * A bag stores kit line ids only (R-BAG-1). Quantities inside a bag always
 * come from the current `calculateKit` output, so a household change ripples
 * into every bag automatically (R-BAG-3: progress is derived, never stored).
 */

export function createBag(
  template: GoBagTemplate,
  input: { id: string; name: string; owner?: string; location?: string; createdAt: string },
): GoBag {
  const definition = BAG_TEMPLATES[template];
  return {
    id: input.id,
    name: input.name.trim() || definition.title,
    owner: (input.owner ?? '').trim(),
    location: (input.location ?? '').trim(),
    template,
    itemIds: [...definition.itemIds],
    packed: {},
    note: '',
    createdAt: input.createdAt,
  };
}

/**
 * R-BAG-7: "Add a personal go-bag" suggests one bag per person, each with the
 * personal template's items. Owners come from the caller (free text).
 */
export function suggestedPersonalBags(
  household: Household,
  createId: (index: number) => string,
  nowIso: string,
): GoBag[] {
  const count = Math.max(0, Math.min(household.people, 20));
  return Array.from({ length: count }, (_, index) =>
    createBag('personal', {
      id: createId(index),
      name: index === 0 ? 'Personal go-bag' : `Personal go-bag ${index + 1}`,
      owner: '',
      createdAt: nowIso,
    }),
  );
}

/**
 * The bag's lines in bag order, resolved against the current kit. Lines that
 * no longer exist in the calculated kit are listed by `missingLineIds` —
 * never silently dropped (R-BAG-1).
 */
export function linesForBag<T extends { id: string }>(bag: GoBag, kitLines: T[]): T[] {
  const byId = new Map(kitLines.map(line => [line.id, line]));
  return bag.itemIds
    .map(id => byId.get(id))
    .filter((line): line is T => Boolean(line));
}

/** Kit line ids a bag references that are not in the current kit (R-BAG-1). */
export function missingLineIds(bag: GoBag, kitLineIds: string[]): string[] {
  const known = new Set(kitLineIds);
  return bag.itemIds.filter(id => !known.has(id));
}

export type BagProgress = {
  total: number;
  packed: number;
  /** 0–100, or null for an empty bag. */
  percent: number | null;
  packedList: string[];
  unpackedList: string[];
};

export function bagProgress(bag: GoBag): BagProgress {
  const total = bag.itemIds.length;
  const packedList = total ? bag.itemIds.filter(id => bag.packed[id]) : [];
  const unpackedList = total ? bag.itemIds.filter(id => !bag.packed[id]) : [];
  return {
    total,
    packed: packedList.length,
    percent: total > 0 ? Math.round((packedList.length / total) * 100) : null,
    packedList,
    unpackedList,
  };
}

function setPacked(bag: GoBag, itemId: string, packed: boolean): GoBag {
  const next = { ...bag.packed };
  if (packed) next[itemId] = true;
  else delete next[itemId];
  return { ...bag, packed: next };
}

export function togglePacked(bag: GoBag, itemId: string): GoBag {
  return setPacked(bag, itemId, !bag.packed[itemId]);
}

export function setPackedFor(bag: GoBag, itemId: string, packed: boolean): GoBag {
  return setPacked(bag, itemId, packed);
}

export function addLineToBag(bag: GoBag, itemId: string): GoBag {
  if (bag.itemIds.includes(itemId)) return bag;
  return { ...bag, itemIds: [...bag.itemIds, itemId] };
}

export function removeLineFromBag(bag: GoBag, itemId: string): GoBag {
  const next = { ...bag, itemIds: bag.itemIds.filter(id => id !== itemId) };
  delete next.packed[itemId];
  return next;
}

/**
 * R-BAG-5: sharing a bag produces text only. The text contains the bag's own
 * contents and quantities — never the household's zone, contacts, or medical
 * details (R-BAG-11).
 */
export function bagToText(
  bag: GoBag,
  kitLines: { id: string; label: string; quantity: number; unit: string; unitPlural: string }[],
  household: Household,
): string {
  const blocks: string[] = [`StormReady go-bag · ${bag.name}`];
  if (bag.owner.trim()) blocks.push(`Owner: ${bag.owner.trim()}`);
  if (bag.location.trim()) blocks.push(`Kept: ${bag.location.trim()}`);
  if (bag.note.trim()) blocks.push(`Note: ${bag.note.trim()}`);
  blocks.push('Items');
  if (!kitLines.length && !bag.itemIds.length) {
    blocks.push('- (no items chosen yet)');
  }
  const byId = new Map(kitLines.map(line => [line.id, line]));
  for (const raw of bag.itemIds) {
    const line = byId.get(raw as never);
    if (!line) {
      blocks.push('☐ Not in your current kit');
      continue;
    }
    const quantity = line.quantity === 1 ? line.unit : line.unitPlural;
    blocks.push(`${bag.packed[line.id] ? '☑' : '☐'} ${line.label} — ${line.quantity} ${quantity}`);
  }
  blocks.push(
    `Quantities follow your household (${household.people} ${household.people === 1 ? 'person' : 'people'} · ${household.days} days). A bag is a starting point — adjust it for your family.`,
  );
  return blocks.join('\n');
}
