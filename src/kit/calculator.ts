import type { Household } from '../plan-schema';
import { KIT_CATALOG, type KitCategory, type KitLine } from './catalog';

/**
 * Pure household → kit calculation. No React, no network, no storage.
 */
export function calculateKit(household: Household): KitLine[] {
  return KIT_CATALOG.flatMap(item => {
    if (item.include && !item.include(household)) return [];
    const quantity = item.quantity(household);
    if (!Number.isFinite(quantity) || quantity <= 0) return [];
    return [{
      id: item.id,
      label: item.label,
      category: item.category,
      quantity,
      unit: item.unit,
      unitPlural: item.unitPlural,
      basis: item.basis(household),
      source: item.source,
      note: item.note,
    }];
  });
}

export function groupKitLines(lines: KitLine[]) {
  const groups = new Map<KitCategory, KitLine[]>();
  for (const line of lines) {
    const group = groups.get(line.category) ?? [];
    group.push(line);
    groups.set(line.category, group);
  }
  return groups;
}

export function kitSummary(household: Household) {
  const lines = calculateKit(household);
  return {
    lines,
    itemCount: lines.length,
    waterGallons: lines.find(line => line.id === 'water')?.quantity ?? 0,
    foodPersonDays: lines.find(line => line.id === 'food')?.quantity ?? 0,
  };
}
