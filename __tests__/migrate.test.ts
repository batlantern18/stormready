import {
  DEFAULT_COMMUNICATION_PLAN,
  DEFAULT_DRILL_STATE,
  DEFAULT_GO_BAG_STATE,
  DEFAULT_HOUSEHOLD,
  DEFAULT_INVENTORY,
  DEFAULT_MEDICAL_PLAN,
  DEFAULT_PROFILE_ID,
  DEFAULT_TASKS,
  DEFAULT_TRAVEL_STATE,
  DEFAULT_ZONE,
  clampHousehold,
  isTaskRelevant,
  visibleTasks,
  type Household,
} from '../src/plan-schema';
import { migratePlanFromV2, moveToProfileMap } from '../src/storage/migrate';
import { LEGACY_PROFILE_ID } from '../src/storage/keys';

describe('migratePlanFromV2', () => {
  it('imports a saved 1.1 plan into the default profile', () => {
    const now = '2026-10-20T00:00:00.000Z';
    const plan = migratePlanFromV2({
      onboarded: true,
      household: {
        people: 4,
        infants: 1,
        days: 10,
        pets: true,
        petCount: 2,
        hasVehicle: false,
        medicalNeeds: true,
        county: 'Miami-Dade',
        accessibilityNeeds: true,
      },
      zone: 'Zone A',
      destination: { label: 'Aunt Ana', address: 'Orlando', transport: 'Drive' },
      tasks: [{ id: 'water', title: 'Water', detail: 'Store water', category: 'Supplies', done: true }],
    }, now);

    expect(plan.onboarded).toBe(true);
    expect(plan.activeProfileId).toBe(LEGACY_PROFILE_ID);
    expect(Object.keys(plan.profiles)).toEqual([LEGACY_PROFILE_ID]);
    expect(plan.updatedAt).toBe(now);

    const profile = plan.profiles[LEGACY_PROFILE_ID];
    expect(profile.household).toMatchObject({
      people: 4,
      infants: 1,
      days: 10,
      pets: true,
      petCount: 2,
      hasVehicle: false,
      medicalNeeds: true,
      accessibilityNeeds: true,
      county: 'Miami-Dade',
      country: 'US',
    });
    expect(profile.zone).toMatchObject({ value: 'Zone A', source: 'manual' });
    expect(profile.destination).toEqual({ label: 'Aunt Ana', address: 'Orlando', transport: 'Drive' });
    expect(profile.tasks).toEqual([{ id: 'water', title: 'Water', detail: 'Store water', category: 'Supplies', done: true }]);
  });

  it('starts every v1.2 feature document empty (R-MIG-3)', () => {
    const plan = migratePlanFromV2({ household: { people: 2 } });
    const profile = plan.profiles.default;
    expect(profile.inventory).toEqual(DEFAULT_INVENTORY);
    expect(profile.goBags).toEqual(DEFAULT_GO_BAG_STATE);
    expect(profile.medical).toEqual(DEFAULT_MEDICAL_PLAN);
    expect(profile.communication).toEqual(DEFAULT_COMMUNICATION_PLAN);
    expect(profile.travel).toEqual(DEFAULT_TRAVEL_STATE);
    expect(profile.drills).toEqual(DEFAULT_DRILL_STATE);
  });

  it('is pure: no clock reads inside (R-MIG-1)', () => {
    const plan = migratePlanFromV2({ household: { people: 2 } }, '2026-05-01T00:00:00.000Z');
    expect(plan.updatedAt).toBe('2026-05-01T00:00:00.000Z');
  });

  it('falls back to the default plan when the input is unusable', () => {
    const plan = migratePlanFromV2(null);
    expect(plan).toEqual({
      ...{
        onboarded: false,
        activeProfileId: DEFAULT_PROFILE_ID,
        profiles: {
          [DEFAULT_PROFILE_ID]: {
            household: DEFAULT_HOUSEHOLD,
            zone: DEFAULT_ZONE,
            destination: { label: '', address: '', transport: '' },
            tasks: DEFAULT_TASKS,
          },
        },
      },
      profiles: {
        [DEFAULT_PROFILE_ID]: {
          household: DEFAULT_HOUSEHOLD,
          zone: DEFAULT_ZONE,
          destination: { label: '', address: '', transport: '' },
          tasks: DEFAULT_TASKS,
          inventory: { entries: {}, lastRotationAt: null },
          goBags: { bags: [] },
          medical: DEFAULT_MEDICAL_PLAN,
          communication: DEFAULT_COMMUNICATION_PLAN,
          travel: { trips: [] },
          drills: { results: [] },
        },
      },
      updatedAt: '',
    });
  });

  it('labels a plain legacy 1.0 zone as manually entered and unverified', () => {
    const plan = migratePlanFromV2({ household: { county: 'Harris' }, zone: '  Zone 3  ' });
    expect(plan.profiles.default.zone).toMatchObject({
      value: 'Zone 3',
      source: 'manual',
      county: 'Harris',
      verifiedAt: null,
      country: 'US',
    });
    expect(plan.profiles.default.zone.notes).toContain('Verify the source');
  });

  it('clamps invalid household numbers into safe limits', () => {
    const plan = migratePlanFromV2({ household: { people: 999, infants: -3, days: 1, pets: false, petCount: 8 } });
    expect(plan.profiles.default.household.people).toBe(20);
    expect(plan.profiles.default.household.infants).toBe(0);
    expect(plan.profiles.default.household.days).toBe(7);
    expect(plan.profiles.default.household.petCount).toBe(0);
  });

  it('keeps valid structured zones and normalizes their fields', () => {
    const plan = migratePlanFromV2({
      zone: {
        value: ' Zone B ',
        source: 'florida-lookup',
        county: ' Pinellas ',
        verifiedAt: '2026-09-01T00:00:00.000Z',
        notes: 'x'.repeat(600),
        sourceUrl: ' https://example.gov/zone ',
      },
    });
    expect(plan.profiles.default.zone).toMatchObject({
      value: 'Zone B',
      source: 'florida-lookup',
      county: 'Pinellas',
      verifiedAt: '2026-09-01T00:00:00.000Z',
      sourceUrl: 'https://example.gov/zone',
    });
    expect(plan.profiles.default.zone.notes).toHaveLength(500);
  });

  it('drops invalid tasks but keeps the rest', () => {
    const plan = migratePlanFromV2({
      tasks: [
        { id: 'water', title: 'Water', done: true },
        { title: 'Missing id' },
        null,
        { id: 'food', category: 'Food' },
      ],
    });
    const tasks = plan.profiles.default.tasks;
    expect(tasks).toHaveLength(2);
    expect(tasks[1]).toMatchObject({ id: 'food', title: 'Preparedness step', category: 'Food', done: false });
  });
});

describe('moveToProfileMap', () => {
  it('wraps a saved value under the default profile', () => {
    const value = { checked: 'now', countryCode: 'US' };
    expect(moveToProfileMap(value)).toEqual({ [DEFAULT_PROFILE_ID]: value });
  });

  it('maps null to an empty map so nothing appears live-on-device', () => {
    expect(moveToProfileMap(null)).toEqual({});
  });
});

describe('clampHousehold', () => {
  it('forces pet count to zero when there are no pets', () => {
    expect(clampHousehold(household({ pets: false, petCount: 5 })).petCount).toBe(0);
  });

  it('keeps at least one pet when pets are enabled', () => {
    expect(clampHousehold(household({ pets: true, petCount: 0 })).petCount).toBe(1);
  });

  it('normalizes the country and keeps the state text', () => {
    const next = clampHousehold(household({ country: 'MX' as never, state: 'Quintana Roo' }));
    expect(next.country).toBe('MX');
    expect(next.state).toBe('Quintana Roo');
  });
});

describe('visibleTasks', () => {
  const tasks = [
    { id: 'water', title: 'Water', detail: '', category: 'Supplies', done: false },
    { id: 'pet', title: 'Pet bag', detail: '', category: 'Pets', done: false, optional: true },
    { id: 'ride', title: 'Backup ride', detail: '', category: 'Travel', done: false, optional: true },
  ];

  it('hides pet and ride tasks that do not apply', () => {
    const visible = visibleTasks(tasks, household({ pets: false, hasVehicle: true }));
    expect(visible.map(task => task.id)).toEqual(['water']);
  });

  it('shows relevant optional tasks', () => {
    const visible = visibleTasks(tasks, household({ pets: true, hasVehicle: false }));
    expect(visible.map(task => task.id)).toEqual(['water', 'pet', 'ride']);
  });

  it('keeps unknown optional tasks visible', () => {
    const task = { id: 'other', title: 'Other', detail: '', category: 'Plan', done: false, optional: true };
    expect(isTaskRelevant(task, household())).toBe(true);
  });
});

function household(overrides: Partial<Household> = {}): Household {
  return { ...DEFAULT_HOUSEHOLD, ...overrides };
}
