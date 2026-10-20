import { DEFAULT_PLAN, DEFAULT_TASKS, type PlanState } from '../src/plan-schema';
import { planReducer, type PlanAction } from '../src/plan-reducer';

function reduce(state: PlanState, ...actions: PlanAction[]) {
  return actions.reduce(planReducer, state);
}

describe('planReducer', () => {
  it('replaces the whole plan when hydrating from storage', () => {
    const stored: PlanState = {
      ...DEFAULT_PLAN,
      onboarded: true,
      household: { ...DEFAULT_PLAN.household, people: 4, county: 'Hillsborough' },
    };
    expect(planReducer(DEFAULT_PLAN, { type: 'replace', value: stored })).toEqual(stored);
  });

  it('merges household changes and clamps them to safe limits', () => {
    const next = planReducer(DEFAULT_PLAN, { type: 'setHousehold', value: { people: 999 } });
    expect(next.household.people).toBe(20);
    expect(next.household.days).toBe(DEFAULT_PLAN.household.days);
  });

  it('keeps unrelated household fields when one field changes', () => {
    const next = reduce(
      DEFAULT_PLAN,
      { type: 'setHousehold', value: { pets: true, petCount: 2 } },
      { type: 'setHousehold', value: { people: 5 } },
    );
    expect(next.household).toMatchObject({ people: 5, pets: true, petCount: 2 });
  });

  it('toggles a task and leaves the others untouched', () => {
    const next = planReducer(DEFAULT_PLAN, { type: 'toggleTask', id: 'water' });
    expect(next.tasks.find(task => task.id === 'water')?.done).toBe(true);
    expect(next.tasks.find(task => task.id === 'food')?.done).toBe(false);
  });

  it('sets a task to an explicit done state', () => {
    const next = reduce(
      DEFAULT_PLAN,
      { type: 'setTaskDone', id: 'meds', done: true },
      { type: 'setTaskDone', id: 'meds', done: false },
    );
    expect(next.tasks.find(task => task.id === 'meds')?.done).toBe(false);
  });

  it('merges destination fields', () => {
    const next = reduce(
      DEFAULT_PLAN,
      { type: 'setDestination', value: { label: 'Aunt Ana' } },
      { type: 'setDestination', value: { address: 'Orlando' } },
    );
    expect(next.destination).toEqual({ label: 'Aunt Ana', address: 'Orlando', transport: '' });
  });

  it('merges zone fields and truncates long notes', () => {
    const next = planReducer(DEFAULT_PLAN, {
      type: 'setZone',
      value: { value: 'Zone C', source: 'manual', notes: 'x'.repeat(600) },
    });
    expect(next.zone.value).toBe('Zone C');
    expect(next.zone.source).toBe('manual');
    expect(next.zone.notes).toHaveLength(500);
  });

  it('marks onboarding complete without touching the rest of the plan', () => {
    const started = reduce(DEFAULT_PLAN, { type: 'setHousehold', value: { people: 3 } });
    const next = planReducer(started, { type: 'completeOnboarding' });
    expect(next.onboarded).toBe(true);
    expect(next.household.people).toBe(3);
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
    expect(next.household).toEqual(DEFAULT_PLAN.household);
    expect(next.tasks).toEqual(DEFAULT_TASKS);
  });

  it('never mutates the state it is given', () => {
    const before = JSON.stringify(DEFAULT_PLAN);
    planReducer(DEFAULT_PLAN, { type: 'setHousehold', value: { people: 9 } });
    planReducer(DEFAULT_PLAN, { type: 'toggleTask', id: 'water' });
    planReducer(DEFAULT_PLAN, { type: 'setZone', value: { value: 'A' } });
    expect(JSON.stringify(DEFAULT_PLAN)).toBe(before);
  });
});
