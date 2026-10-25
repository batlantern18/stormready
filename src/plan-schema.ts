export type ZoneSource = 'florida-lookup' | 'manual' | 'none';
export type CountryCode = 'US' | 'MX';

export type VerifiedZone = {
  value: string;
  source: ZoneSource;
  county: string;
  verifiedAt: string | null;
  notes: string;
  /** Optional address of the page where the user verified the zone. */
  sourceUrl: string;
  /** Country the zone info belongs to. Added in v1.2; 'US' for older data. */
  country: CountryCode;
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
  /** Added in v1.2: drives Spanish content and the Mexico source list. */
  country: CountryCode;
  /** Added in v1.2: US state or Mexican state name, used by the season model. */
  state: string;
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

/* ------------------------------------------------------------------ */
/* Schema v3 — new feature documents (StormReady v1.2 "Resilience")    */
/* ------------------------------------------------------------------ */

export type ProfileId = string;

/** F01 — Kit Inventory & Expiry Tracker. */
export type InventoryEntry = {
  itemId: string; // matches KitLine.id in the catalog
  owned: boolean;
  quantityOwned: number;
  purchasedAt: string | null; // ISO 8601
  expiresAt: string | null; // ISO 8601
  note: string;
};

export type InventoryState = {
  entries: Record<string, InventoryEntry>; // keyed by itemId
  lastRotationAt: string | null;
};

/** F02 — Go-Bag Builder. */
export type GoBagTemplate = 'personal' | 'vehicle' | 'work' | 'kids' | 'home' | 'custom';

export type GoBag = {
  id: string;
  name: string;
  owner: string; // free text, may be empty
  location: string;
  template: GoBagTemplate;
  itemIds: string[]; // kit line ids
  packed: Record<string, boolean>; // kit line id → packed
  note: string;
  createdAt: string;
};

export type GoBagState = { bags: GoBag[] };

/** F03 — Medication & Medical Needs Plan. */
export type Medication = {
  id: string;
  name: string;
  dose: string;
  schedule: string;
  days: number;
  refrigerated: boolean;
  prescriptionRefillDate: string | null;
  pharmacy: string;
  notes: string;
};

export type MedicalDevicePower = 'mains' | 'battery' | 'both';

export type MedicalDevice = {
  id: string;
  name: string;
  powerSource: MedicalDevicePower;
  backupHours: number;
  needsRefrigeration: boolean;
};

export type MedicalContact = {
  id: string;
  name: string;
  phone: string;
  role: string;
};

export type MedicalPlan = {
  medications: Medication[];
  devices: MedicalDevice[];
  contacts: MedicalContact[];
  allergies: string;
  notes: string;
};

/** F04 — Family Communication & Meeting Plan. */
export type EmergencyContact = {
  id: string;
  name: string;
  phone: string;
  relationship: string;
  distance: string;
};

export type MeetingPoint = { label: string; address: string; note: string };

export type CheckInPlan = {
  who: string;
  everyHours: number;
  method: string;
  fallback: string;
};

export type CommunicationPlan = {
  contacts: EmergencyContact[];
  meetingPoint: MeetingPoint;
  checkIn: CheckInPlan;
  backup: { contact: string; method: string; note: string };
};

/** F05 — Travel Mode. The field ships in schema v3; the feature arrives later. */
export type TravelPlan = {
  id: string;
  name: string;
  destination: string;
  region: string;
  startDate: string | null;
  endDate: string | null;
  people: number;
  days: number;
  notes: string;
  checklist: Task[]; // reuses the existing Task type
  createdAt: string;
};

export type TravelState = { trips: TravelPlan[] };

/** F08 — Scenario Drills. */
export type DrillAnswer = 'ready' | 'not-yet' | 'skipped';

export type DrillSuggestedTask = { id: string; title: string; detail: string; category: string };

export type DrillResult = {
  id: string;
  drillId: string;
  completedAt: string;
  durationSeconds: number;
  answers: Record<string, DrillAnswer>;
  suggestedTasks: DrillSuggestedTask[];
};

export type DrillState = { results: DrillResult[] };

/** The per-profile payload — everything that was in the v2 PlanState. */
export type ProfilePlan = {
  household: Household;
  zone: VerifiedZone;
  destination: Destination;
  tasks: Task[];
  inventory: InventoryState;
  goBags: GoBagState;
  medical: MedicalPlan;
  communication: CommunicationPlan;
  travel: TravelState;
  drills: DrillState;
};

export type PlanState = {
  onboarded: boolean;
  activeProfileId: ProfileId;
  profiles: Record<ProfileId, ProfilePlan>;
  /** Set on every persist; drives staleness hints and the seasonal prompt. */
  updatedAt: string;
};

/** The v1.1 document shape, kept for the v2 → v3 migration. */
export type PlanStateV2 = {
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
  country: 'US',
  state: '',
};

export const DEFAULT_ZONE: VerifiedZone = {
  value: '',
  source: 'none',
  county: '',
  verifiedAt: null,
  notes: '',
  sourceUrl: '',
  country: 'US',
};

export const DEFAULT_INVENTORY: InventoryState = {
  entries: {},
  lastRotationAt: null,
};

export const DEFAULT_GO_BAG_STATE: GoBagState = { bags: [] };

export const DEFAULT_MEDICAL_PLAN: MedicalPlan = {
  medications: [],
  devices: [],
  contacts: [],
  allergies: '',
  notes: '',
};

export const DEFAULT_COMMUNICATION_PLAN: CommunicationPlan = {
  contacts: [],
  meetingPoint: { label: '', address: '', note: '' },
  checkIn: { who: '', everyHours: 24, method: '', fallback: '' },
  backup: { contact: '', method: '', note: '' },
};

export const DEFAULT_TRAVEL_STATE: TravelState = { trips: [] };

export const DEFAULT_DRILL_STATE: DrillState = { results: [] };

export const DEFAULT_PROFILE_ID: ProfileId = 'default';

export const DEFAULT_PROFILE_PLAN: ProfilePlan = {
  household: DEFAULT_HOUSEHOLD,
  zone: DEFAULT_ZONE,
  destination: { label: '', address: '', transport: '' },
  tasks: DEFAULT_TASKS,
  inventory: DEFAULT_INVENTORY,
  goBags: DEFAULT_GO_BAG_STATE,
  medical: DEFAULT_MEDICAL_PLAN,
  communication: DEFAULT_COMMUNICATION_PLAN,
  travel: DEFAULT_TRAVEL_STATE,
  drills: DEFAULT_DRILL_STATE,
};

export const DEFAULT_PLAN: PlanState = {
  onboarded: false,
  activeProfileId: DEFAULT_PROFILE_ID,
  profiles: { [DEFAULT_PROFILE_ID]: DEFAULT_PROFILE_PLAN },
  updatedAt: '',
};

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
