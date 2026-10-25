import { daysSinceDrill, drillById, drillRecordText, drillScoreSummary, isDrillDue, lastDrill, scoreDrill, suggestedTasksFor } from '../src/scenarios/model';
import { DRILLS } from '../src/scenarios/drills';
import type { DrillResult } from '../src/plan-schema';

const powerOutage = drillById('power-outage')!;

function result(overrides: Partial<DrillResult> = {}): DrillResult {
  return {
    id: 'r1',
    drillId: 'power-outage',
    completedAt: '2026-10-01T00:00:00.000Z',
    durationSeconds: 240,
    answers: { lights: 'ready', radio: 'not-yet', devices: 'skipped' },
    suggestedTasks: [],
    ...overrides,
  };
}

describe('drill catalog (F08)', () => {
  it('ships five scenarios, each ten minutes or less (R-DRL-1)', () => {
    expect(DRILLS.map(drill => drill.id)).toEqual(['power-outage', 'evacuation', 'shelter-night', 'home-medical', 'communication-failure']);
    for (const drill of DRILLS) {
      expect([3, 5, 10]).toContain(drill.minutes);
      expect(drill.steps.length).toBeGreaterThan(2);
      expect(drill.debrief).toBeTruthy();
      for (const step of drill.steps) {
        expect(step.prompt).toBeTruthy();
        // Prompts are questions, never emergency instructions.
        expect(step.prompt.endsWith('?')).toBe(true);
      }
    }
  });

  it('links a suggested task to every "not yet" answerable step (R-DRL-2)', () => {
    for (const drill of DRILLS) {
      for (const step of drill.steps) {
        if (!step.taskLink) continue;
        expect(step.taskLink.title).toBeTruthy();
        expect(step.taskLink.detail).toBeTruthy();
        expect(step.taskLink.category).toBeTruthy();
      }
    }
    expect(powerOutage.steps[0].taskLink?.title).toBe('Set one flashlight spot');
  });

  it('looks up unknown drills as null', () => {
    expect(drillById('nope')).toBeNull();
  });
});

describe('scoring', () => {
  it('counts ready, not-yet, and skipped answers', () => {
    expect(scoreDrill(powerOutage, result().answers)).toMatchObject({ total: 6, ready: 1, notYet: 1, skipped: 4, skippedAll: false });
    expect(scoreDrill(powerOutage, { lights: 'skipped' }).skippedAll).toBe(true);
    expect(scoreDrill(powerOutage, { lights: 'ready', radio: 'ready', devices: 'not-yet', fridge: 'not-yet', 'cold-medication': 'ready', neighbour: 'ready' })).toMatchObject({ ready: 4, notYet: 2 });
  });

  it('summarizes the score in encouraging copy (R-DRL-3)', () => {
    expect(drillScoreSummary(result())).toBe('1 of 6 — 5 things to pick up.');
    const perfect = result({ answers: { lights: 'ready', radio: 'ready', devices: 'ready', fridge: 'ready', 'cold-medication': 'ready', neighbour: 'ready' } });
    expect(drillScoreSummary(perfect)).toBe('6 of 6 — everything ready.');
    expect(drillScoreSummary(result({ drillId: 'nope' }))).toBe('');
  });

  it('collects suggested tasks only from not-yet answers', () => {
    const tasks = suggestedTasksFor(powerOutage, result().answers);
    expect(tasks.map(task => task.title)).toEqual(['Get a battery radio']);
  });
});

describe('drill records (R-DRL-9)', () => {
  it('keeps the date, name, score, and not-yet items — nothing else', () => {
    const text = drillRecordText(result());
    expect(text).toContain('StormReady drill · Power outage');
    expect(text).toContain('1 of 6 — 5 things to pick up.');
    expect(text).toContain('Not yet:');
    expect(text).toContain('- Get a battery radio');
    expect(text).not.toContain('Insulin');
    expect(text).not.toContain('Zone');
  });

  it('handles an unknown drill id and raw completion dates', () => {
    expect(drillRecordText(result({ drillId: 'nope', completedAt: 'not-a-date' }))).toContain('nope');
  });
});

describe('drill recency (R-DRL-10)', () => {
  const now = new Date('2026-10-19T12:00:00.000Z');

  it('finds the latest drill and the days since', () => {
    const results = [
      result({ id: 'old', completedAt: '2026-08-01T00:00:00.000Z' }),
      result({ id: 'new', completedAt: '2026-10-10T00:00:00.000Z' }),
    ];
    expect(lastDrill(results)?.id).toBe('new');
    expect(daysSinceDrill(results, now)).toBe(9);
    expect(daysSinceDrill([], now)).toBeNull();
    expect(daysSinceDrill([result({ completedAt: 'nonsense' })], now)).toBeNull();
  });

  it('prompts only after 60 days, and only when a drill exists', () => {
    expect(isDrillDue([], now)).toBe(false);
    expect(isDrillDue([result({ completedAt: '2026-08-19T12:00:00.000Z' })], now)).toBe(true);
    expect(isDrillDue([result({ completedAt: '2026-10-01T12:00:00.000Z' })], now)).toBe(false);
  });
});
