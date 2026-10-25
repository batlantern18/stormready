import type { Household, MedicalPlan, CommunicationPlan } from '../plan-schema';
import { medicalKitLines } from '../medical/model';
import { hasOutOfAreaContact } from '../comms/model';
import { KIT_CATALOG, READY_GOV, type KitCategory, type KitLine } from './catalog';

/**
 * Pure household → kit calculation. No React, no network, no storage.
 *
 * F03: `medicalPlan` is optional and backwards-compatible — existing callers
 * keep working; the three medical-plan lines appear only when a plan exists.
 */
export function calculateKit(
  household: Household,
  medicalPlan?: MedicalPlan,
  communicationPlan?: CommunicationPlan,
): KitLine[] {
  const fromMexico = household.country === 'MX';
  const catalogLines: KitLine[] = KIT_CATALOG.flatMap(item => {
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
      sourceMx: item.sourceMx,
      shelfLifeMonths: item.shelfLifeMonths,
      rotationNote: item.rotationNote,
      note: item.note,
    }];
  });
  const sourceFor = (line: KitLine): KitLine =>
    fromMexico && line.sourceMx ? { ...line, source: line.sourceMx } : line;

  const commsLines: KitLine[] = [];
  if (communicationPlan && !hasOutOfAreaContact(communicationPlan)) {
    commsLines.push({
      id: 'communication-card',
      label: 'Communication card',
      category: 'people',
      quantity: 1,
      unit: 'card',
      unitPlural: 'cards',
      basis: 'No out-of-area contact recorded',
      source: READY_GOV.plan,
      note: 'Record an out-of-area contact and a meeting point in Plan → Communication. The card is shareable offline, through the share sheet only.',
    });
  }

  return medicalPlan || communicationPlan
    ? [
        ...catalogLines,
        ...(medicalPlan ? medicalKitLines(medicalPlan, household) : []),
        ...commsLines,
      ].map(sourceFor)
    : catalogLines.map(sourceFor);
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

export function kitSummary(household: Household, medicalPlan?: MedicalPlan, communicationPlan?: CommunicationPlan) {
  const lines = calculateKit(household, medicalPlan, communicationPlan);
  return {
    lines,
    itemCount: lines.length,
    waterGallons: lines.find(line => line.id === 'water')?.quantity ?? 0,
    foodPersonDays: lines.find(line => line.id === 'food')?.quantity ?? 0,
  };
}
