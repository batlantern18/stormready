import type { CommunicationPlan, EmergencyContact } from '../plan-schema';

/**
 * F04 — Family Communication & Meeting Plan (pure).
 *
 * The card is designed to be read by a stranger. Anything the user has not
 * filled in is omitted — no placeholder "N/A" lines (R-COM-3). Phone numbers
 * are free text rendered as `tel:` links and are never dialed automatically
 * (R-COM-1).
 */

const MILE = 1; // distances are free text; only the number is inspected
const NEAR_MILES = 15;

export function telHref(phone: string): string {
  return `tel:${phone.trim()}`;
}

/** R-COM-9: a distance under 15 miles is an informational note, not an error. */
export function contactDistanceMiles(contact: EmergencyContact): number | null {
  const match = contact.distance.match(/\d+(\.\d+)?/);
  if (!match) return null;
  const value = Number.parseFloat(match[0]);
  return Number.isFinite(value) ? value * MILE : null;
}

export function isContactNear(contact: EmergencyContact): boolean | null {
  const miles = contactDistanceMiles(contact);
  return miles === null ? null : miles < NEAR_MILES;
}

export function hasOutOfAreaContact(plan: CommunicationPlan): boolean {
  return plan.contacts.some(contact => contact.name.trim() || contact.phone.trim());
}

export function needsOutOfAreaContact(plan: CommunicationPlan): boolean {
  return !hasOutOfAreaContact(plan);
}

/**
 * 0–100 % across the four parts filled: contacts, meeting point, check-in,
 * backup plan. Derived, never stored.
 */
export function commsCompletion(plan: CommunicationPlan): number {
  const parts = [
    hasOutOfAreaContact(plan),
    Boolean(plan.meetingPoint.label.trim() || plan.meetingPoint.address.trim()),
    Boolean(plan.checkIn.who.trim() || plan.checkIn.method.trim()),
    Boolean(plan.backup.contact.trim() || plan.backup.method.trim()),
  ];
  return Math.round((parts.filter(Boolean).length / parts.length) * 100);
}

export type CommsCardContext = {
  /** Zone label + provenance + age, e.g. "Zone C · entered by you · 12 days ago". */
  zoneLine?: string;
  /** Household size line, e.g. "4 people · 2 pets". */
  householdLine?: string;
};

/**
 * The one-page card. R-COM-2: the zone appears with its provenance and age so
 * the recipient knows how fresh it is — and never as a safety claim.
 */
export function communicationCardText(
  plan: CommunicationPlan,
  context: CommsCardContext = {},
): string {
  const blocks: string[] = ['StormReady communication card'];
  if (context.householdLine) blocks.push(context.householdLine);

  if (hasOutOfAreaContact(plan)) {
    blocks.push('If we are missing, contact');
    for (const contact of plan.contacts) {
      if (!contact.name.trim() && !contact.phone.trim()) continue;
      const name = contact.name.trim() || 'Contact';
      const phone = contact.phone.trim();
      const relationship = contact.relationship.trim();
      blocks.push(`- ${relationship ? `${relationship} ` : ''}${name}${phone ? ` · ${phone}` : ''}`);
    }
  }

  if (plan.meetingPoint.label.trim() || plan.meetingPoint.address.trim()) {
    blocks.push('Meeting point');
    if (plan.meetingPoint.label.trim()) blocks.push(`- ${plan.meetingPoint.label.trim()}`);
    if (plan.meetingPoint.address.trim()) blocks.push(`- ${plan.meetingPoint.address.trim()}`);
    if (plan.meetingPoint.note.trim()) blocks.push(`- ${plan.meetingPoint.note.trim()}`);
  }

  if (plan.checkIn.who.trim() || plan.checkIn.method.trim()) {
    const cadence = `every ${plan.checkIn.everyHours} ${plan.checkIn.everyHours === 1 ? 'hour' : 'hours'}`;
    const lines: string[] = [];
    if (plan.checkIn.who.trim() && plan.checkIn.method.trim()) {
      lines.push(`${plan.checkIn.who.trim()} checks in ${cadence} by ${plan.checkIn.method.trim()}`);
    } else if (plan.checkIn.who.trim()) {
      lines.push(`${plan.checkIn.who.trim()} checks in ${cadence}`);
    } else {
      lines.push(`Checks in ${cadence} by ${plan.checkIn.method.trim()}`);
    }
    if (plan.checkIn.fallback.trim()) lines.push(`If there is no reply: ${plan.checkIn.fallback.trim()}`);
    blocks.push('Check-in plan', ...lines.map(line => `- ${line}`));
  }

  if (plan.backup.contact.trim() || plan.backup.method.trim()) {
    blocks.push('Backup plan');
    if (plan.backup.contact.trim()) blocks.push(`- Backup contact: ${plan.backup.contact.trim()}`);
    if (plan.backup.method.trim()) blocks.push(`- Method: ${plan.backup.method.trim()}`);
    if (plan.backup.note.trim()) blocks.push(`- ${plan.backup.note.trim()}`);
  }

  if (context.zoneLine) blocks.push(`Zone on record: ${context.zoneLine}`);

  if (blocks.length === 1) return 'No communication plan recorded yet.';
  blocks.push('StormReady never sends data anywhere. This card was made on-device and shared by you.');
  return blocks.join('\n');
}
