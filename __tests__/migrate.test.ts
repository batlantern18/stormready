import { migratePlanFromV1 } from '../src/storage/migrate';
import { DEFAULT_PLAN, clampHousehold, isTaskRelevant, visibleTasks, type Household } from '../src/plan-schema';

function household(overrides: Partial<Household> = {}): Household {
  return { ...DEFAULT_PLAN.household, ...overrides };
}

describe('migratePlanFromV1', () => {
  it('imports a 1.0 plan without forcing onboarding', () => {
    const plan = migratePlanFromV1({
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
        zone: 'legacy-household-zone',
      },
      zone: 'Zone A',
      destination: { label: 'Aunt Ana', address: 'Orlando', transport: 'Drive' },
      tasks: [{ id: 'water', title: 'Water', detail: 'Store water', category: 'Supplies', done: true }],
    });

    expect(plan.onboarded).toBe(true);
    expect(plan.household).toMatchObject({
      people: 4,
      infants: 1,
      days: 10,
      pets: true,
      petCount: 2,
      hasVehicle: false,
      medicalNeeds: true,
      accessibilityNeeds: true,
      county: 'Miami-Dade',
    });
    expect(plan.destination).toEqual({ label: 'Aunt Ana', address: 'Orlando', transport: 'Drive' });
    expect(plan.tasks).toEqual([{ id: 'water', title: 'Water', detail: 'Store water', category: 'Supplies', done: true }]);
  });

  it('labels a plain 1.0 zone as manually entered and unverified', () => {
    const plan = migratePlanFromV1({ household: { county: 'Harris' }, zone: '  Zone 3  ' });
    expect(plan.zone).toMatchObject({
      value: 'Zone 3',
      source: 'manual',
      county: 'Harris',
      verifiedAt: null,
    });
    expect(plan.zone.notes).toContain('Verify the source');
  });

  it('uses a household zone when the top-level zone is missing', () => {
    const plan = migratePlanFromV1({ household: { county: 'Bexar', zone: 'B' } });
    expect(plan.zone.value).toBe('B');
    expect(plan.zone.county).toBe('Bexar');
  });

  it('leaves an empty legacy zone unset', () => {
    const plan = migratePlanFromV1({ household: { county: 'Travis' }, zone: '   ' });
    expect(plan.zone).toMatchObject({ value: '', source: 'none', county: 'Travis', verifiedAt: null });
  });

  it('clamps invalid household numbers into safe limits', () => {
    const plan = migratePlanFromV1({
      household: { people: 999, infants: -3, days: 1, pets: false, petCount: 8 },
    });
    expect(plan.household.people).toBe(20);
    expect(plan.household.infants).toBe(0);
    expect(plan.household.days).toBe(7);
    expect(plan.household.petCount).toBe(0);
  });

  it('falls back to the default plan when no usable fields exist', () => {
    expect(migratePlanFromV1(null)).toEqual(DEFAULT_PLAN);
    expect(migratePlanFromV1('not a plan')).toEqual(DEFAULT_PLAN);
    const plan = migratePlanFromV1({});
    expect(plan.household).toEqual(DEFAULT_PLAN.household);
    expect(plan.tasks).toEqual(DEFAULT_PLAN.tasks);
    expect(plan.onboarded).toBe(true);
  });

  it('keeps valid structured zones and normalizes their fields', () => {
    const plan = migratePlanFromV1({
      zone: {
        value: ' Zone B ',
        source: 'florida-lookup',
        county: ' Pinellas ',
        verifiedAt: '2026-09-01T00:00:00.000Z',
        notes: 'x'.repeat(600),
        sourceUrl: ' https://example.gov/zone ',
      },
    });
    expect(plan.zone.value).toBe('Zone B');
    expect(plan.zone.source).toBe('florida-lookup');
    expect(plan.zone.county).toBe('Pinellas');
    expect(plan.zone.verifiedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(plan.zone.notes).toHaveLength(500);
    expect(plan.zone.sourceUrl).toBe('https://example.gov/zone');
  });

  it('drops invalid tasks but keeps the rest', () => {
    const plan = migratePlanFromV1({
      tasks: [
        { id: 'water', title: 'Water', done: true },
        { title: 'Missing id' },
        null,
        { id: 'food', category: 'Food' },
      ],
    });
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[1]).toMatchObject({ id: 'food', title: 'Preparedness step', category: 'Food', done: false });
  });
});

describe('clampHousehold', () => {
  it('forces pet count to zero when there are no pets', () => {
    expect(clampHousehold(household({ pets: false, petCount: 5 })).petCount).toBe(0);
  });

  it('keeps at least one pet when pets are enabled', () => {
    expect(clampHousehold(household({ pets: true, petCount: 0 })).petCount).toBe(1);
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
