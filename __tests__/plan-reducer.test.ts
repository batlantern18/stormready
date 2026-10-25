import { DEFAULT_PLAN, DEFAULT_PROFILE_ID, DEFAULT_PROFILE_PLAN, DEFAULT_TASKS, type PlanState, type ProfilePlan } from '../src/plan-schema';
import { planReducer, type PlanAction } from '../src/plan-reducer';

function reduce(state: PlanState, ...actions: PlanAction[]) {
  return actions.reduce(planReducer, state);
}

/** The active profile document after some actions. */
function active(state: PlanState): ProfilePlan {
  return state.profiles[state.activeProfileId];
}

describe('planReducer', () => {
  it('replaces the whole plan when hydrating from storage', () => {
    const stored: PlanState = {
      ...DEFAULT_PLAN,
      onboarded: true,
      updatedAt: '2026-10-19T00:00:00.000Z',
    };
    expect(planReducer(DEFAULT_PLAN, { type: 'replace', value: stored })).toEqual(stored);
  });

  it('writes household changes into the active profile, not the envelope', () => {
    const next = planReducer(DEFAULT_PLAN, { type: 'setHousehold', value: { people: 4 } });
    expect(next.onboarded).toBe(false);
    expect(active(next).household.people).toBe(4);
    expect(Object.keys(next.profiles)).toEqual([DEFAULT_PROFILE_ID]);
  });

  it('merges household changes and clamps them to safe limits', () => {
    const next = planReducer(DEFAULT_PLAN, { type: 'setHousehold', value: { people: 999 } });
    expect(active(next).household.people).toBe(20);
    expect(active(next).household.days).toBe(DEFAULT_PROFILE_PLAN.household.days);
  });

  it('keeps unrelated household fields when one field changes', () => {
    const next = reduce(
      DEFAULT_PLAN,
      { type: 'setHousehold', value: { pets: true, petCount: 2 } },
      { type: 'setHousehold', value: { people: 5 } },
    );
    expect(active(next).household).toMatchObject({ people: 5, pets: true, petCount: 2 });
  });

  it('toggles a task and leaves the others untouched', () => {
    const next = planReducer(DEFAULT_PLAN, { type: 'toggleTask', id: 'water' });
    expect(active(next).tasks.find(task => task.id === 'water')?.done).toBe(true);
    expect(active(next).tasks.find(task => task.id === 'food')?.done).toBe(false);
  });

  it('sets a task to an explicit done state', () => {
    const next = reduce(
      DEFAULT_PLAN,
      { type: 'setTaskDone', id: 'meds', done: true },
      { type: 'setTaskDone', id: 'meds', done: false },
    );
    expect(active(next).tasks.find(task => task.id === 'meds')?.done).toBe(false);
  });

  it('adds a suggested task under a fresh id', () => {
    const next = planReducer(DEFAULT_PLAN, {
      type: 'addTask',
      value: { id: 'drill-lights', title: 'Set one flashlight spot', detail: '', category: 'Supplies', done: false },
    });
    expect(active(next).tasks.some(task => task.id === 'drill-lights')).toBe(true);
  });

  it('never overwrites an existing task id', () => {
    const next = planReducer(DEFAULT_PLAN, {
      type: 'addTask',
      value: { id: 'water', title: 'Overwrite!', detail: 'x', category: 'Supplies', done: false },
    });
    expect(next).toEqual(DEFAULT_PLAN);
  });

  it('merges destination fields', () => {
    const next = reduce(
      DEFAULT_PLAN,
      { type: 'setDestination', value: { label: 'Aunt Ana' } },
      { type: 'setDestination', value: { address: 'Orlando' } },
    );
    expect(active(next).destination).toEqual({ label: 'Aunt Ana', address: 'Orlando', transport: '' });
  });

  it('merges zone fields, truncates long notes, and normalizes the country', () => {
    const next = planReducer(DEFAULT_PLAN, {
      type: 'setZone',
      value: { value: 'Zone C', source: 'manual', notes: 'x'.repeat(600), country: 'MX' as never },
    });
    const { zone } = active(next);
    expect(zone.value).toBe('Zone C');
    expect(zone.source).toBe('manual');
    expect(zone.notes).toHaveLength(500);
    expect(zone.country).toBe('MX');
  });

  it('stores feature documents on the active profile', () => {
    const next = reduce(
      DEFAULT_PLAN,
      { type: 'setInventory', value: { entries: { water: { itemId: 'water', owned: true, quantityOwned: 4, purchasedAt: null, expiresAt: null, note: '' } }, lastRotationAt: null } },
      { type: 'setGoBags', value: { bags: [{ id: 'bag1', name: 'Bag', owner: '', location: '', template: 'personal', itemIds: [], packed: {}, note: '', createdAt: '' }] } },
      { type: 'setMedical', value: { medications: [], devices: [], contacts: [{ id: 'c1', name: 'Dr', phone: '', role: '' }], allergies: '', notes: '' } },
      { type: 'setCommunication', value: { contacts: [], meetingPoint: { label: '', address: '', note: '' }, checkIn: { who: '', everyHours: 999 as number, method: '', fallback: '' }, backup: { contact: '', method: '', note: '' } } },
      { type: 'addDrillResult', value: { id: 'd1', drillId: 'power-outage', completedAt: '2026-01-01T00:00:00.000Z', durationSeconds: 120, answers: {}, suggestedTasks: [] } },
      { type: 'addDrillResult', value: { id: 'd2', drillId: 'power-outage', completedAt: '2026-02-01T00:00:00.000Z', durationSeconds: 120, answers: {}, suggestedTasks: [] } },
    );
    const profile = active(next);
    expect(profile.inventory.entries.water?.owned).toBe(true);
    expect(profile.goBags.bags).toHaveLength(1);
    expect(profile.medical.contacts).toHaveLength(1);
    expect(profile.communication.checkIn.everyHours).toBe(168); // clamped
    expect(profile.drills.results).toHaveLength(2);
    expect(profile.drills.results[0].id).toBe('d2'); // newest first
  });

  it('marks onboarding complete without touching the rest of the plan', () => {
    const started = reduce(DEFAULT_PLAN, { type: 'completeOnboarding' }, { type: 'setHousehold', value: { people: 3 } });
    expect(started.onboarded).toBe(true);
    expect(active(started).household.people).toBe(3);
  });

  it('clears the plan but keeps the user onboarded', () => {
    const populated = reduce(
      DEFAULT_PLAN,
      { type: 'completeOnboarding' },
      { type: 'setHousehold', value: { people: 4 } },
      { type: 'setTaskDone', id: 'water', done: true },
    );
    const next = planReducer(populated, { type: 'reset' });
    expect(next.onboarded).toBe(true);
    expect(active(next).household).toEqual(DEFAULT_PROFILE_PLAN.household);
    expect(active(next).tasks).toEqual(DEFAULT_TASKS);
  });

  it('wipes everything including onboarding state', () => {
    const populated = reduce(
      DEFAULT_PLAN,
      { type: 'completeOnboarding' },
      { type: 'setHousehold', value: { people: 4 } },
    );
    const next = planReducer(populated, { type: 'wipe' });
    expect(next).toEqual(DEFAULT_PLAN);
  });

  it('never mutates the state it is given', () => {
    const before = JSON.stringify(DEFAULT_PLAN);
    planReducer(DEFAULT_PLAN, { type: 'setHousehold', value: { people: 9 } });
    planReducer(DEFAULT_PLAN, { type: 'toggleTask', id: 'water' });
    planReducer(DEFAULT_PLAN, { type: 'setZone', value: { value: 'A' } });
    planReducer(DEFAULT_PLAN, { type: 'addDrillResult', value: { id: 'd', drillId: 'power-outage', completedAt: '', durationSeconds: 0, answers: {}, suggestedTasks: [] } });
    expect(JSON.stringify(DEFAULT_PLAN)).toBe(before);
  });
});
