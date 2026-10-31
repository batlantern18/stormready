import { DEFAULT_HOUSEHOLD } from './defaults';
import type {
  CheckInPlan,
  CountryCode,
  Household,
  InventoryEntry,
  MedicalDevice,
  Medication,
  MedicalPlan,
  Task,
} from './types';

/**
 * Schema v3 validation: clamps, derivations, and task visibility.
 *
 * This module owns every clamp function and derivation that turns raw
 * user input into a valid `MedicalPlan`, `Household`, and `CheckInPlan` —
 * plus the task-visibility helpers that gate optional tasks behind
 * household conditions. The `LIMITS` constant collects all hard bounds
 * so they are easy to audit against requirements.
 */

export const LIMITS = {
  people: { min: 1, max: 20 },
  infants: { min: 0, max: 20 },
  days: { min: 7, max: 30 },
  petCount: { min: 0, max: 20 },
  notes: 500,
  // v1.2 additions
  inventoryQuantity: { min: 0, max: 9999 },
  inventoryNote: 140,
  medicationDays: { min: 1, max: 365 },
  deviceBackupHours: { min: 0, max: 168 },
  checkInHours: { min: 1, max: 168 },
  tripDays: { min: 1, max: 30 },
  tripNotes: 500,
} as const;

export function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

export function normalizeCountry(value: unknown): CountryCode {
  return value === 'MX' ? 'MX' : 'US';
}

export function clampHousehold(next: Household): Household {
  return {
    ...next,
    people: clampInt(next.people, LIMITS.people.min, LIMITS.people.max, DEFAULT_HOUSEHOLD.people),
    infants: clampInt(next.infants, LIMITS.infants.min, LIMITS.infants.max, DEFAULT_HOUSEHOLD.infants),
    days: clampInt(next.days, LIMITS.days.min, LIMITS.days.max, DEFAULT_HOUSEHOLD.days),
    petCount: next.pets
      ? clampInt(next.petCount, LIMITS.petCount.min + 1, LIMITS.petCount.max, 1)
      : 0,
    country: normalizeCountry(next.country),
    state: typeof next.state === 'string' ? next.state : '',
  };
}

export function isTaskRelevant(task: Task, household: Household) {
  if (!task.optional) return true;
  if (task.id === 'pet') return household.pets;
  if (task.id === 'ride') return !household.hasVehicle;
  return true;
}

export function visibleTasks(tasks: Task[], household: Household) {
  return tasks.filter(task => isTaskRelevant(task, household));
}

/* ------------------------------------------------------------------ */
/* Schema v3 clamps and derivations                                    */
/* ------------------------------------------------------------------ */

/** R-INV-3: a date in the future for `purchasedAt` is rejected upstream. */
export function isFutureIsoDate(value: string | null, nowIso: string) {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return false;
  return time > new Date(nowIso).getTime();
}

/** R-INV-2: quantity is clamped to [0, 9999] and stored as an integer. */
export function clampInventoryEntry(entry: InventoryEntry): InventoryEntry {
  return {
    ...entry,
    itemId: typeof entry.itemId === 'string' ? entry.itemId : '',
    owned: entry.owned === true,
    quantityOwned: clampInt(
      entry.quantityOwned,
      LIMITS.inventoryQuantity.min,
      LIMITS.inventoryQuantity.max,
      0,
    ),
    purchasedAt: typeof entry.purchasedAt === 'string' ? entry.purchasedAt : null,
    expiresAt: typeof entry.expiresAt === 'string' ? entry.expiresAt : null,
    note: (typeof entry.note === 'string' ? entry.note : '').slice(0, LIMITS.inventoryNote),
  };
}

/** R-MED-4: days is clamped to [1, 365]; backupHours to [0, 168]. */
export function clampMedication(value: Medication): Medication {
  return {
    ...value,
    days: clampInt(value.days, LIMITS.medicationDays.min, LIMITS.medicationDays.max, 7),
    prescriptionRefillDate:
      typeof value.prescriptionRefillDate === 'string' ? value.prescriptionRefillDate : null,
  };
}

export function clampMedicalDevice(value: MedicalDevice): MedicalDevice {
  return {
    ...value,
    backupHours: clampInt(
      value.backupHours,
      LIMITS.deviceBackupHours.min,
      LIMITS.deviceBackupHours.max,
      0,
    ),
  };
}

/** R-COM-4: `everyHours` is clamped to [1, 168]. */
export function clampCheckIn(value: CheckInPlan): CheckInPlan {
  return {
    ...value,
    everyHours: clampInt(value.everyHours, LIMITS.checkInHours.min, LIMITS.checkInHours.max, 24),
  };
}

/** R-MED-1: household.medicalNeeds becomes derived — true when the plan is non-empty. */
export function isMedicalPlanEmpty(plan: MedicalPlan) {
  return (
    plan.medications.length === 0 &&
    plan.devices.length === 0 &&
    plan.contacts.length === 0 &&
    plan.allergies.trim() === '' &&
    plan.notes.trim() === ''
  );
}

export function effectiveMedicalNeeds(household: Household, medical: MedicalPlan) {
  return household.medicalNeeds || !isMedicalPlanEmpty(medical);
}
