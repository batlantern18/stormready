import {
  READY_BANDS,
  READINESS_WEIGHTS,
  bandForScore,
  readinessScore,
  type ReadinessInput,
} from '../src/readiness/score';
import { currentSeason, seasonCheck } from '../src/readiness/season';
import {
  DEFAULT_COMMUNICATION_PLAN,
  DEFAULT_HOUSEHOLD,
  DEFAULT_INVENTORY,
  DEFAULT_MEDICAL_PLAN,
  DEFAULT_TASKS,
  DEFAULT_ZONE,
  type DrillResult,
} from '../src/plan-schema';

function input(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    household: DEFAULT_HOUSEHOLD,
    tasks: DEFAULT_TASKS,
    kitLines: [{ id: 'water', quantity: 14, unit: 'gal' }, { id: 'food', quantity: 14, unit: 'person-day' }],
    inventory: DEFAULT_INVENTORY,
    zone: DEFAULT_ZONE,
    goBags: { bags: [] },
    medical: DEFAULT_MEDICAL_PLAN,
    communication: DEFAULT_COMMUNICATION_PLAN,
    drills: [],
    ...overrides,
  };
}

const now = new Date('2026-10-19T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

describe('score bands (R-RDY-7)', () => {
  it('draws the band boundaries at 85 / 55 / 30', () => {
    expect(bandForScore(100)).toBe('ready');
    expect(bandForScore(85)).toBe('ready');
    expect(bandForScore(84)).toBe('almost');
    expect(bandForScore(55)).toBe('almost');
    expect(bandForScore(54)).toBe('attention');
    expect(bandForScore(30)).toBe('attention');
    expect(bandForScore(29)).toBe('starting');
  });

  it('labels every band with plain copy', () => {
    for (const band of Object.values(READY_BANDS)) {
      expect(band.label).toBeTruthy();
      expect(band.copy).toBeTruthy();
      expect(band.range[0]).toBeLessThanOrEqual(band.range[1]);
    }
  });
});

describe('readinessScore (R-RDY-1, R-RDY-4)', () => {
  it('scores an untouched plan low with honest reasons and actions', () => {
    const score = readinessScore(input(), now);
    expect(score.total).toBeLessThan(30);
    expect(score.band).toBe('starting');
    expect(score.topGaps.length).toBeGreaterThan(0);
    expect(score.topGaps.length).toBeLessThanOrEqual(3);
    for (const factor of score.factors) {
      expect(factor.weight).toBe(READINESS_WEIGHTS[factor.id as keyof typeof READINESS_WEIGHTS]);
      expect(factor.reason).toBeTruthy();
      expect(factor.earned).toBeGreaterThanOrEqual(0);
      expect(factor.earned).toBeLessThanOrEqual(1);
    }
  });

  it('maxes out every factor on a complete plan', () => {
    const complete = input({
      tasks: DEFAULT_TASKS.map(task => ({ ...task, done: true })),
      inventory: {
        entries: {
          water: { itemId: 'water', owned: true, quantityOwned: 14, purchasedAt: '2026-06-01T00:00:00.000Z', expiresAt: '2099-01-01', note: '' },
          food: { itemId: 'food', owned: true, quantityOwned: 14, purchasedAt: null, expiresAt: null, note: '' },
        },
        lastRotationAt: now.toISOString(),
      },
      zone: { ...DEFAULT_ZONE, value: 'Zone C', source: 'manual', verifiedAt: now.toISOString() },
      goBags: { bags: [{ id: 'b1', name: 'Bag', owner: '', location: '', template: 'personal', itemIds: ['water', 'food'], packed: { water: true, food: true }, note: '', createdAt: '' }] },
      communication: {
        ...DEFAULT_COMMUNICATION_PLAN,
        contacts: [{ id: 'c', name: 'Ana', phone: '', relationship: '', distance: '' }],
        meetingPoint: { label: 'Publix', address: '500 5th', note: '' },
        checkIn: { who: 'Ben', everyHours: 24, method: 'text', fallback: '' },
        backup: { contact: 'Ana', method: '', note: '' },
      },
      drills: [{ id: 'r', drillId: 'power-outage', completedAt: now.toISOString(), durationSeconds: 60, answers: {}, suggestedTasks: [] }],
    });
    const score = readinessScore(complete, now);
    expect(score.total).toBe(100);
    expect(score.band).toBe('ready');
    expect(score.topGaps).toEqual([]);
  });

  it('weights account for every factor emitted', () => {
    const score = readinessScore(input(), now);
    for (const factor of score.factors) {
      expect(Object.keys(READINESS_WEIGHTS)).toContain(factor.id);
    }
  });

  it('derives coverage from the inventory, not the checklist (R-INV-5)', () => {
    const partial = input({ inventory: { entries: { water: { itemId: 'water', owned: true, quantityOwned: 7, purchasedAt: null, expiresAt: null, note: '' } }, lastRotationAt: null } });
    const coverage = readinessScore(partial, now).factors.find(factor => factor.id === 'coverage');
    expect(coverage?.earned).toBe(0.5);
    expect(coverage?.reason).toContain('7 of the 14');
  });

  it('skips the expiry factor until something is owned', () => {
    const empty = readinessScore(input(), now);
    expect(empty.factors.some(factor => factor.id === 'expiry')).toBe(false);
    const owned = readinessScore(input({ inventory: { entries: { water: { itemId: 'water', owned: true, quantityOwned: 14, purchasedAt: null, expiresAt: null, note: '' } }, lastRotationAt: null } }), now);
    expect(owned.factors.find(factor => factor.id === 'expiry')?.reason).toContain('Nothing in your kit is expired');
  });

  it('penalizes expired and expiring supplies', () => {
    const entries = {
      water: { itemId: 'water', owned: true, quantityOwned: 4, purchasedAt: null, expiresAt: '2026-01-01T00:00:00.000Z', note: '' },
      food: { itemId: 'food', owned: true, quantityOwned: 4, purchasedAt: null, expiresAt: new Date(now.getTime() + 30 * DAY).toISOString(), note: '' },
    };
    const factor = readinessScore(input({ inventory: { entries, lastRotationAt: null } }), now).factors.find(f => f.id === 'expiry');
    expect(factor?.reason).toContain('1 expired');
    expect(factor?.reason).toContain('expiring soon');
  });

  it('includes the medical factor only when the household has medical needs (R-MED-1)', () => {
    expect(readinessScore(input(), now).factors.some(factor => factor.id === 'medical')).toBe(false);
    const withNeeds = readinessScore(input({ household: { ...DEFAULT_HOUSEHOLD, medicalNeeds: true } }), now);
    expect(withNeeds.factors.find(factor => factor.id === 'medical')?.earned).toBe(0);
    const withPlan = readinessScore(input({
      medical: { medications: [{ id: 'm', name: 'Insulin', dose: '', schedule: '', days: 7, refrigerated: false, prescriptionRefillDate: null, pharmacy: '', notes: '' }], devices: [], contacts: [], allergies: '', notes: '' },
    }), now);
    expect(withPlan.factors.find(factor => factor.id === 'medical')?.earned).toBe(1);
  });

  it('marks a stale zone and rewards a fresh one', () => {
    const stale = readinessScore(input({ zone: { ...DEFAULT_ZONE, value: 'Zone C', source: 'manual', verifiedAt: new Date(now.getTime() - 200 * DAY).toISOString() } }), now);
    const factor = stale.factors.find(f => f.id === 'zone');
    expect(factor?.earned).toBe(0.5);
    expect(factor?.reason).toContain('out of date');
    const fresh = readinessScore(input({ zone: { ...DEFAULT_ZONE, value: 'Zone C', source: 'florida-lookup', verifiedAt: now.toISOString() } }), now);
    expect(fresh.factors.find(f => f.id === 'zone')?.earned).toBe(1);
  });

  it('rewards a recent drill at full weight and halves an old one', () => {
    const recent = readinessScore(input({ drills: [{ id: 'r', drillId: 'power-outage', completedAt: new Date(now.getTime() - 10 * DAY).toISOString(), durationSeconds: 60, answers: {}, suggestedTasks: [] }] }), now);
    expect(recent.factors.find(f => f.id === 'drills')?.earned).toBe(1);
    const old = readinessScore(input({ drills: [{ id: 'r', drillId: 'power-outage', completedAt: new Date(now.getTime() - 90 * DAY).toISOString(), durationSeconds: 60, answers: {}, suggestedTasks: [] }] }), now);
    expect(old.factors.find(f => f.id === 'drills')?.earned).toBe(0.5);
  });

  it('rates kit review recency across the 12-month line', () => {
    expect(readinessScore(input(), now).factors.find(f => f.id === 'kitReview')?.earned).toBe(0.5);
    const fresh = readinessScore(input({ inventory: { entries: {}, lastRotationAt: new Date(now.getTime() - 30 * DAY).toISOString() } }), now);
    expect(fresh.factors.find(f => f.id === 'kitReview')?.earned).toBe(1);
  });

  it('sorts the top gaps by earned weight (worst first)', () => {
    const score = readinessScore(input(), now);
    const earned = score.topGaps.map(factor => factor.earned);
    expect([...earned].sort((a, b) => a - b)).toEqual(earned);
  });

  it('is pure: the same input yields the same score and does not touch its input', () => {
    const state = input();
    const first = readinessScore(state, now);
    const second = readinessScore(state, now);
    expect(first).toEqual(second);
    expect(JSON.stringify(state)).toBe(JSON.stringify(input()));
  });
});

describe('season model (F09, R-RDY-5)', () => {
  const jun19 = new Date(2026, 5, 19);

  it('matches hurricane season for Gulf and Southeast states', () => {
    expect(currentSeason('US', 'FL', jun19)?.id).toBe('hurricane');
    expect(currentSeason('US', 'florida', jun19)?.id).toBe('hurricane');
    expect(currentSeason('US', 'TX', jun19)?.id).toBe('hurricane');
    expect(currentSeason('US', 'FL', new Date(2026, 11, 25))).toBeNull(); // December
  });

  it('matches wildfire season for western states', () => {
    expect(currentSeason('US', 'CA', jun19)?.id).toBe('wildfire');
    expect(currentSeason('US', 'CO', new Date(2026, 2, 15))).toBeNull(); // March is before April
  });

  it('gives northern states the winter season', () => {
    expect(currentSeason('US', 'NY', new Date(2026, 0, 15))?.id).toBe('winter');
    expect(currentSeason('US', 'NY', jun19)).toBeNull();
  });

  it('stays silent for unknown or empty states (honest silence)', () => {
    expect(currentSeason('US', '', jun19)).toBeNull();
    expect(currentSeason('US', 'Bavaria', jun19)).toBeNull();
  });

  it('uses the SMN hurricane season for Mexico', () => {
    expect(currentSeason('MX', '', jun19)?.id).toBe('hurricane');
    expect(currentSeason('MX', '', jun19)?.authority.url).toContain('smn.conagua.gob.mx');
    expect(currentSeason('MX', '', new Date(2026, 2, 1))).toBeNull();
  });

  it('prompts only when the kit has not been rotated since the season began', () => {
    const check = seasonCheck('US', 'FL', jun19, null);
    expect(check?.season.id).toBe('hurricane');
    expect(seasonCheck('US', 'FL', jun19, new Date(2026, 5, 15).toISOString())).toBeNull(); // after 1 June
    expect(seasonCheck('US', 'FL', jun19, new Date(2025, 11, 1).toISOString())).not.toBeNull(); // before
    expect(seasonCheck('US', '', jun19, null)).toBeNull();
  });
});
