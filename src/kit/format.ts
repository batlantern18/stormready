import type { Household } from '../plan-schema';
import { CATEGORY_LABELS, CATEGORY_ORDER, type KitLine } from './catalog';

export function formatQuantity(line: Pick<KitLine, 'quantity' | 'unit' | 'unitPlural'>) {
  const rounded = Math.round(line.quantity * 10) / 10;
  return `${rounded} ${rounded === 1 ? line.unit : line.unitPlural}`;
}

export function formatGallons(gallons: number) {
  return `${Math.round(gallons * 10) / 10} gal`;
}

export function householdSummary(household: Household) {
  const people = `${household.people} ${household.people === 1 ? 'person' : 'people'}`;
  const parts = [people];
  if (household.infants > 0) parts.push(`${household.infants} ${household.infants === 1 ? 'infant' : 'infants'}`);
  if (household.pets) parts.push(`${household.petCount} ${household.petCount === 1 ? 'pet' : 'pets'}`);
  parts.push(`${household.days} days`);
  return parts.join(' · ');
}

/** Plain-text kit list for the system share sheet. */
export function kitToText(lines: KitLine[], household: Household, generatedAt = new Date()) {
  const date = generatedAt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const output: string[] = [
    'StormReady emergency kit',
    `Household: ${householdSummary(household)}`,
    `Prepared: ${date}`,
    '',
    'This is a planning baseline, not an official requirement. Follow current guidance from your local emergency authority.',
    '',
  ];

  for (const category of CATEGORY_ORDER) {
    const group = lines.filter(line => line.category === category);
    if (!group.length) continue;
    output.push(CATEGORY_LABELS[category].toUpperCase());
    for (const line of group) {
      output.push(`- ${formatQuantity(line)} — ${line.label}`);
      output.push(`  Why: ${line.basis}`);
      output.push(`  Source: ${line.source.label} (${line.source.url})`);
      if (line.note) output.push(`  Note: ${line.note}`);
    }
    output.push('');
  }

  output.push('Review this list every season and replace expired supplies.');
  output.push('StormReady is a preparedness organizer, not an emergency alert authority.');
  return output.join('\n');
}
