import type {
  CommunicationPlan,
  DrillState,
  GoBagState,
  Household,
  InventoryState,
  MedicalPlan,
  PlanState,
  ProfileId,
  ProfilePlan,
  Task,
  TravelState,
  VerifiedZone,
} from './types';

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
