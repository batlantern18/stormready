import { clampMedication, clampMedicalDevice, isMedicalPlanEmpty, type Household, type MedicalPlan } from '../plan-schema';
import type { KitLine } from '../kit/catalog';
import { READY_GOV } from '../kit/catalog';

/**
 * F03 — Medication & Medical Needs Plan (pure).
 *
 * Every string this module produces names the user's own input, never a
 * clinical requirement (R-MED-2). Nothing here calls a clinician, a pharmacy,
 * or a network.
 */

export type MedicalCardFields = {
  medications: boolean;
  doses: boolean;
  schedules: boolean;
  pharmacies: boolean;
  devices: boolean;
  contacts: boolean;
  allergies: boolean;
  notes: boolean;
};

/** R-MED-3: the default card shows name, dose, schedule, and allergies. */
export const DEFAULT_MEDICAL_CARD_FIELDS: MedicalCardFields = {
  medications: true,
  doses: true,
  schedules: true,
  pharmacies: false,
  devices: false,
  contacts: false,
  allergies: true,
  notes: false,
};

export function needsRefrigeration(plan: MedicalPlan) {
  return plan.medications.some(medication => medication.refrigerated) ||
    plan.devices.some(device => device.needsRefrigeration);
}

export function needsPower(plan: MedicalPlan) {
  return plan.devices.some(device => device.powerSource !== 'battery');
}

export function refrigeratedCount(plan: MedicalPlan) {
  return plan.medications.filter(medication => medication.refrigerated).length;
}

/**
 * The longest supply the household needs on hand (R-MED-9: a person on a
 * 30-day prescription is never told to stock 7). `null` when no medications.
 */
export function longestPrescriptionDays(plan: MedicalPlan): number | null {
  if (plan.medications.length === 0) return null;
  return Math.max(...plan.medications.map(medication => medication.days));
}

export function earliestRefill(plan: MedicalPlan): string | null {
  const dates = plan.medications
    .map(medication => medication.prescriptionRefillDate)
    .filter((value): value is string => Boolean(value))
    .map(value => new Date(value).getTime())
    .filter(value => !Number.isNaN(value));
  if (!dates.length) return null;
  return new Date(Math.min(...dates)).toISOString();
}

/** The three medical kit lines (F03) — emitted by the calculator when relevant. */
export function medicalKitLines(plan: MedicalPlan, household: Household): KitLine[] {
  const lines: KitLine[] = [];

  const refrigerated = refrigeratedCount(plan);
  if (refrigerated > 0) {
    lines.push({
      id: 'medical-cooler-pack',
      label: 'Refrigerated medication cooler pack',
      category: 'medical',
      quantity: 1,
      unit: 'cooler pack',
      unitPlural: 'cooler packs',
      basis: `Your medical plan lists ${refrigerated} refrigerated ${refrigerated === 1 ? 'medicine' : 'medicines'}`,
      source: READY_GOV.medication,
      note: 'This is a planning aid based on your own entries — your clinician decides what you need. A qualified cooler can hold medication for about 48 hours without ice.',
    });
  }

  if (needsPower(plan)) {
    const names = plan.devices
      .filter(device => device.powerSource !== 'battery')
      .map(device => device.name.trim() || 'a powered device')
      .slice(0, 4);
    lines.push({
      id: 'medical-backup-power',
      label: 'Backup power for medical devices',
      category: 'medical',
      quantity: 1,
      unit: 'kit',
      unitPlural: 'kits',
      basis: `Your medical plan lists ${names.join(', ')}`,
      source: READY_GOV.power,
      note: 'Check each device’s backup hours in your medical plan. A power outage longer than that needs a generator, a facility, or a plan with your clinician.',
    });
  }

  const longestDays = longestPrescriptionDays(plan);
  if (longestDays !== null) {
    lines.push({
      id: 'medical-extra-days',
      label: 'Extra prescription supply',
      category: 'medical',
      quantity: longestDays,
      unit: 'day',
      unitPlural: 'days',
      basis: `Longest supply in your medical plan: ${longestDays} ${longestDays === 1 ? 'day' : 'days'} across ${plan.medications.length} ${plan.medications.length === 1 ? 'medication' : 'medications'}`,
      source: READY_GOV.medication,
      note: 'Ask your clinician or pharmacist how to prepare an emergency supply. This is your own tracking, not a requirement.',
    });
  }

  void household;
  return lines;
}

/**
 * R-MED-3 / R-MED-10: the medical card export is opt-in per field. Only the
 * fields the user selected appear; unselected text (a pharmacy, a device
 * name) must never leak into the card.
 */
export function medicalCardText(plan: MedicalPlan, selected: MedicalCardFields): string {
  const isDefault = isMedicalPlanEmpty(plan);
  if (isDefault) return 'No medical plan recorded yet.';
  const sections: string[] = ['StormReady medical summary card'];
  if (selected.medications && plan.medications.length) {
    sections.push('Medications');
    for (const raw of plan.medications.map(clampMedication)) {
      const parts: string[] = [`- ${raw.name.trim() || 'Medication'}`];
      if (selected.doses && raw.dose.trim()) parts.push(`dose: ${raw.dose.trim()}`);
      if (selected.schedules && raw.schedule.trim()) parts.push(`schedule: ${raw.schedule.trim()}`);
      if (selected.pharmacies && raw.pharmacy.trim()) parts.push(`pharmacy: ${raw.pharmacy.trim()}`);
      if (selected.notes && raw.notes.trim()) parts.push(`notes: ${raw.notes.trim()}`);
      sections.push(parts.join(' · '));
    }
  }
  if (selected.devices && plan.devices.length) {
    sections.push('Powered devices');
    for (const raw of plan.devices.map(clampMedicalDevice)) {
      sections.push(`- ${raw.name.trim() || 'Device'} (${raw.powerSource}, backup ${raw.backupHours} h)`);
    }
  }
  if (selected.contacts && plan.contacts.length) {
    sections.push('Clinicians and contacts');
    for (const contact of plan.contacts) {
      const name = contact.name.trim() || 'Contact';
      const role = contact.role.trim();
      const phone = contact.phone.trim();
      sections.push(`- ${role ? `${role}: ` : ''}${name}${phone ? ` · ${phone}` : ''}`);
    }
  }
  if (selected.allergies && plan.allergies.trim()) {
    sections.push('Allergies');
    sections.push(plan.allergies.trim());
  }
  if (selected.notes && plan.notes.trim()) {
    sections.push('Notes');
    sections.push(plan.notes.trim());
  }
  if (sections.length === 1) return 'No medical plan recorded yet.';
  return sections.join('\n');
}
