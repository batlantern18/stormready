export type ZoneSource = 'florida-lookup' | 'manual' | 'none';

export type VerifiedZone = {
  value: string;
  source: ZoneSource;
  county: string;
  verifiedAt: string | null;
  notes: string;
  /** Optional address of the page where the user verified the zone. */
  sourceUrl: string;
};

export type Household = {
  people: number;
  infants: number;
  days: number;
  pets: boolean;
  petCount: number;
  hasVehicle: boolean;
  medicalNeeds: boolean;
  county: string;
  accessibilityNeeds: boolean;
};

export type Task = {
  id: string;
  title: string;
  detail: string;
  category: string;
  done: boolean;
  optional?: boolean;
};

export type Destination = { label: string; address: string; transport: string };

export type PlanState = {
  onboarded: boolean;
  household: Household;
  zone: VerifiedZone;
  destination: Destination;
  tasks: Task[];
};

export const DEFAULT_TASKS: Task[] = [
  { id: 'water', title: 'Set aside drinking water', detail: 'Use local emergency guidance to decide how much water and supplies to store.', category: 'Supplies', done: false },
  { id: 'food', title: 'Build a shelf-stable food supply', detail: 'Include a manual can opener and foods your household can eat.', category: 'Supplies', done: false },
  { id: 'meds', title: 'Refill prescriptions and gather essentials', detail: 'Follow your clinician’s instructions for medicines and medical equipment.', category: 'Health', done: false },
  { id: 'documents', title: 'Protect important documents', detail: 'Store copies in a waterproof pouch or secure digital location.', category: 'Home', done: false },
  { id: 'contacts', title: 'Choose an out-of-area contact', detail: 'Share the contact and meeting place with everyone in your household.', category: 'People', done: false },
  { id: 'pet', title: 'Prepare your pet’s go-bag', detail: 'Food, leash, carrier, identification and records.', category: 'Pets', done: false, optional: true },
  { id: 'ride', title: 'Confirm a backup ride', detail: 'Agree on who can help and how you will reach them.', category: 'Travel', done: false, optional: true },
];

export const DEFAULT_HOUSEHOLD: Household = {
  people: 2,
  infants: 0,
  days: 7,
  pets: false,
  petCount: 0,
  hasVehicle: true,
  medicalNeeds: false,
  county: '',
  accessibilityNeeds: false,
};

export const DEFAULT_ZONE: VerifiedZone = {
  value: '',
  source: 'none',
  county: '',
  verifiedAt: null,
  notes: '',
  sourceUrl: '',
};

export const DEFAULT_PLAN: PlanState = {
  onboarded: false,
  household: DEFAULT_HOUSEHOLD,
  zone: DEFAULT_ZONE,
  destination: { label: '', address: '', transport: '' },
  tasks: DEFAULT_TASKS,
};

export const LIMITS = {
  people: { min: 1, max: 20 },
  infants: { min: 0, max: 20 },
  days: { min: 7, max: 30 },
  petCount: { min: 0, max: 20 },
  notes: 500,
} as const;

export function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
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
