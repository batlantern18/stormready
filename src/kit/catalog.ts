import type { Household } from '../plan-schema';

export type KitCategory =
  | 'water'
  | 'food'
  | 'health'
  | 'medical'
  | 'power'
  | 'documents'
  | 'people'
  | 'pets'
  | 'access';

export type KitSource = { label: string; url: string };

export type KitLine = {
  id: string;
  label: string;
  category: KitCategory;
  quantity: number;
  unit: string;
  unitPlural: string;
  basis: string;
  source: KitSource;
  /** Source shown when the household's country is Mexico (F10). */
  sourceMx?: KitSource;
  /** Months a stored item stays good (F01); undefined = no maker's date. */
  shelfLifeMonths?: number;
  /** One-line rotation guidance (F01). */
  rotationNote?: string;
  note?: string;
};

export type KitItemDefinition = Omit<KitLine, 'quantity' | 'basis'> & {
  quantity: (household: Household) => number;
  basis: (household: Household) => string;
  include?: (household: Household) => boolean;
};

export const CATEGORY_LABELS: Record<KitCategory, string> = {
  water: 'Water',
  food: 'Food',
  health: 'Health & first aid',
  medical: 'Medical plan',
  power: 'Power & light',
  documents: 'Documents & money',
  people: 'People & communication',
  pets: 'Pets',
  access: 'Accessibility',
};

export const CATEGORY_ORDER: KitCategory[] = [
  'water',
  'food',
  'health',
  'medical',
  'power',
  'documents',
  'people',
  'pets',
  'access',
];

export const READY_GOV = {
  kit: { label: 'Ready.gov — Build a kit', url: 'https://www.ready.gov/kit' },
  water: { label: 'Ready.gov — Water', url: 'https://www.ready.gov/water' },
  food: { label: 'Ready.gov — Food', url: 'https://www.ready.gov/food' },
  pets: { label: 'Ready.gov — Pets', url: 'https://www.ready.gov/pets' },
  medication: { label: 'Ready.gov — Medication', url: 'https://www.ready.gov/medication' },
  power: { label: 'Ready.gov — Power outages', url: 'https://www.ready.gov/power-outages' },
  documents: { label: 'Ready.gov — Financial preparedness', url: 'https://www.ready.gov/financial-preparedness' },
  disability: { label: 'Ready.gov — Disability & access needs', url: 'https://www.ready.gov/disability' },
  plan: { label: 'Ready.gov — Make a plan', url: 'https://www.ready.gov/plan' },
} as const;

/**
 * F10: Mexican authorities for kit guidance. Every catalog line shows the
 * source that matches the household's country — Ready.gov in the US,
 * Protección Civil in Mexico. Adding finer per-item Mexican links later is a
 * data change.
 */
export const MX_CIVIL_PROTECTION: KitSource = {
  label: 'Protección Civil — kit guidance',
  url: 'https://www.gob.mx/proteccioncivil',
};

export const KIT_CATALOG: KitItemDefinition[] = [
  {
    id: 'water',
    label: 'Drinking water',
    category: 'water',
    unit: 'gal',
    unitPlural: 'gal',
    source: READY_GOV.water,
    quantity: household => household.people * household.days,
    basis: household => `${household.people} ${household.people === 1 ? 'person' : 'people'} × ${household.days} days × 1 gallon per person per day`,
    note: 'A planning baseline. Heat, pregnancy, illness, and medical needs can increase water needs.',
    shelfLifeMonths: 12,
    rotationNote: 'Rotate every 12 months. Freeze one jug, mark the date, and use the oldest first.',
  },
  {
    id: 'food',
    label: 'Shelf-stable food',
    category: 'food',
    unit: 'person-day',
    unitPlural: 'person-days',
    source: READY_GOV.food,
    quantity: household => household.people * household.days,
    basis: household => `${household.people} ${household.people === 1 ? 'person' : 'people'} × ${household.days} days of food your household can eat`,
    note: 'Include a manual can opener and foods that do not need refrigeration or cooking.',
    shelfLifeMonths: 12,
    rotationNote: 'Check dates twice a year and replace what you eat with fresh stock.',
  },
  {
    id: 'infant-supplies',
    label: 'Infant feeding supplies',
    category: 'food',
    unit: 'infant-day',
    unitPlural: 'infant-days',
    source: READY_GOV.kit,
    include: household => household.infants > 0,
    quantity: household => household.infants * household.days,
    basis: household => `${household.infants} ${household.infants === 1 ? 'infant' : 'infants'} × ${household.days} days`,
    note: 'Formula, bottles, and water if your household uses them. Follow your pediatrician’s guidance.',
  },
  {
    id: 'medication',
    label: 'Prescription medicines and medical supplies',
    category: 'health',
    unit: 'day',
    unitPlural: 'days',
    source: READY_GOV.medication,
    include: household => household.medicalNeeds,
    quantity: household => household.days,
    basis: household => `${household.days}-day supply, matching your plan horizon`,
    note: 'Ask your clinician or pharmacist how to prepare an emergency supply.',
  },
  {
    id: 'first-aid',
    label: 'First-aid kit',
    category: 'health',
    unit: 'kit',
    unitPlural: 'kits',
    source: READY_GOV.kit,
    quantity: () => 1,
    basis: () => 'One household kit',
    note: 'Check expiration dates and add any items your household specifically needs.',
    shelfLifeMonths: 24,
    rotationNote: 'Check the kit’s expiry dates once a year and replace what expired.',
  },
  {
    id: 'masks',
    label: 'Dust masks',
    category: 'health',
    unit: 'mask',
    unitPlural: 'masks',
    source: READY_GOV.kit,
    quantity: household => household.people,
    basis: household => `One per person × ${household.people} ${household.people === 1 ? 'person' : 'people'}`,
  },
  {
    id: 'hygiene',
    label: 'Personal hygiene kit',
    category: 'health',
    unit: 'kit',
    unitPlural: 'kits',
    source: READY_GOV.kit,
    quantity: () => 1,
    basis: () => 'One household kit',
  },
  {
    id: 'flashlights',
    label: 'Flashlights',
    category: 'power',
    unit: 'flashlight',
    unitPlural: 'flashlights',
    source: READY_GOV.power,
    quantity: household => household.people,
    basis: household => `One per person × ${household.people} ${household.people === 1 ? 'person' : 'people'}`,
  },
  {
    id: 'batteries',
    label: 'Spare batteries',
    category: 'power',
    unit: 'spare set',
    unitPlural: 'spare sets',
    source: READY_GOV.power,
    quantity: household => household.people,
    basis: household => `One spare set per flashlight × ${household.people} ${household.people === 1 ? 'person' : 'people'}`,
    shelfLifeMonths: 24,
    rotationNote: 'Batteries have a use-by date on the packaging. Test them when the clocks change.',
  },
  {
    id: 'radio',
    label: 'Battery-powered or hand-crank radio',
    category: 'power',
    unit: 'radio',
    unitPlural: 'radios',
    source: READY_GOV.power,
    quantity: () => 1,
    basis: () => 'One per household, with spare batteries if it needs them',
  },
  {
    id: 'power-banks',
    label: 'Charged power banks',
    category: 'power',
    unit: 'power bank',
    unitPlural: 'power banks',
    source: READY_GOV.power,
    quantity: household => household.people,
    basis: household => `One per person × ${household.people} ${household.people === 1 ? 'person' : 'people'}`,
  },
  {
    id: 'cash',
    label: 'Emergency cash in small bills',
    category: 'documents',
    unit: 'set',
    unitPlural: 'sets',
    source: READY_GOV.documents,
    quantity: () => 1,
    basis: () => 'One household set, with an amount that fits your budget',
  },
  {
    id: 'documents',
    label: 'Waterproof document pouch',
    category: 'documents',
    unit: 'pouch',
    unitPlural: 'pouches',
    source: READY_GOV.documents,
    quantity: () => 1,
    basis: () => 'One household pouch for copies of important records',
  },
  {
    id: 'contacts',
    label: 'Written emergency contact card',
    category: 'people',
    unit: 'card',
    unitPlural: 'cards',
    source: READY_GOV.plan,
    quantity: () => 1,
    basis: () => 'One card per household, with a copy kept in each go-bag',
  },
  {
    id: 'blankets',
    label: 'Emergency blankets',
    category: 'people',
    unit: 'blanket',
    unitPlural: 'blankets',
    source: READY_GOV.kit,
    quantity: household => household.people,
    basis: household => `One per person × ${household.people} ${household.people === 1 ? 'person' : 'people'}`,
  },
  {
    id: 'pet-supplies',
    label: 'Pet food, water, and carrier or leash',
    category: 'pets',
    unit: 'pet-day',
    unitPlural: 'pet-days',
    source: READY_GOV.pets,
    include: household => household.pets,
    quantity: household => household.petCount * household.days,
    basis: household => `${household.petCount} ${household.petCount === 1 ? 'pet' : 'pets'} × ${household.days} days`,
    note: 'Adjust portions for each animal’s size and needs, and include records, identification, and a carrier or leash.',
    shelfLifeMonths: 12,
    rotationNote: 'Rotate pet food every 12 months and check records when you visit the vet.',
  },
  {
    id: 'access-supplies',
    label: 'Backup accessibility supplies',
    category: 'access',
    unit: 'kit',
    unitPlural: 'kits',
    source: READY_GOV.disability,
    include: household => household.accessibilityNeeds,
    quantity: () => 1,
    basis: () => 'One household kit',
    note: 'Spare batteries, chargers, and supplies for mobility, hearing, vision, communication, or medical devices you rely on.',
  },
];

// F10: assign the Mexican source to every catalog line. Lines can override
// `sourceMx` individually later; today they all share the national authority.
for (const item of KIT_CATALOG) {
  item.sourceMx = MX_CIVIL_PROTECTION;
}
