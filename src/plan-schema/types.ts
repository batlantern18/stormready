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
