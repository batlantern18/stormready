import {
  coverageFor,
  entryFor,
  expiryReport,
  orphanEntries,
  stampRotation,
} from '../src/inventory/model';
import { isRotationDue, nextRotation, rotationDateFor } from '../src/inventory/rotation';
import type { InventoryEntry } from '../src/plan-schema';

function entry(overrides: Partial<InventoryEntry> = {}): InventoryEntry {
  return {
    itemId: 'water',
    owned: true,
    quantityOwned: 4,
    purchasedAt: null,
    expiresAt: null,
    note: '',
    ...overrides,
  };
}

const now = new Date('2026-10-19T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

describe('inventory coverage', () => {
  const lines = [
    { id: 'water', quantity: 14, unit: 'gal' },
    { id: 'food', quantity: 14, unit: 'person-day' },
  ];

  it('reports full shortfall on an empty inventory', () => {
    const [water, food] = coverageFor(lines, { entries: {}, lastRotationAt: null });
    expect(water).toMatchObject({ required: 14, owned: 0, shortfall: 14, percent: 0, covered: false, unit: 'gal' });
    expect(food).toMatchObject({ required: 14, owned: 0, shortfall: 14, covered: false });
  });

  it('reports partial coverage', () => {
    const [water] = coverageFor(lines, { entries: { water: entry() }, lastRotationAt: null });
    expect(water).toMatchObject({ required: 14, owned: 4, shortfall: 10, percent: 29, covered: false });
  });

  it('caps over-coverage at 100 and never reports an error (R-INV-11)', () => {
    const [water] = coverageFor(lines, { entries: { water: entry({ quantityOwned: 40 }) }, lastRotationAt: null });
    expect(water).toMatchObject({ owned: 40, shortfall: 0, percent: 100, covered: true });
  });

  it('ignores entries that are not owned', () => {
    const [water] = coverageFor(lines, { entries: { water: entry({ owned: false, quantityOwned: 10 }) }, lastRotationAt: null });
    expect(water.owned).toBe(0);
  });

  it('returns a null percent when there is no water requirement', () => {
    const [water] = coverageFor([{ id: 'water', quantity: 0, unit: 'gal' }], { entries: {}, lastRotationAt: null });
    expect(water.percent).toBeNull();
    expect(water.covered).toBe(false);
  });
});

describe('entry helpers', () => {
  it('clamps a corrupted quantity of "abc" (R-INV-11)', () => {
    expect(entryFor({ entries: { water: entry({ quantityOwned: 'abc' as never }) }, lastRotationAt: null }, 'water')?.quantityOwned).toBe(0);
  });
});

describe('expiry report', () => {
  it('treats exactly 60 days as expiring soon and 61 as not', () => {
    const inWindow = expiryReport({ water: entry({ expiresAt: new Date(now.getTime() + 60 * DAY).toISOString() }) }, now);
    expect(inWindow.expiringSoon).toHaveLength(1);
    expect(inWindow.expired).toHaveLength(0);
    const outWindow = expiryReport({ water: entry({ expiresAt: new Date(now.getTime() + 61 * DAY).toISOString() }) }, now);
    expect(outWindow.expiringSoon).toHaveLength(0);
    expect(outWindow.expired).toHaveLength(0);
  });

  it('separates expired from expiring and keeps expired visible (R-INV-6)', () => {
    const report = expiryReport({ water: entry({ expiresAt: '2026-01-01T00:00:00.000Z' }) }, now);
    expect(report.expired).toHaveLength(1);
    expect(report.expiringSoon).toHaveLength(0);
    expect(expiryReport({ water: entry({ expiresAt: '2099-01-01T00:00:00.000Z' }) }, now)).toMatchObject({ expired: [], expiringSoon: [] });
    expect(expiryReport({ water: entry({ owned: false, expiresAt: '2026-01-01T00:00:00.000Z' }) }, now).expired).toHaveLength(0);
    expect(expiryReport({ water: entry({ expiresAt: 'not a date' }) }, now)).toMatchObject({ expired: [], expiringSoon: [] });
  });
});

describe('rotation windows', () => {
  it('computes the rotation date from purchasedAt plus shelf life months', () => {
    const due = rotationDateFor(entry({ purchasedAt: '2026-03-15T00:00:00.000Z' }), 12);
    expect(due?.getMonth()).toBe(2); // March + 12 = March next year
    expect(due?.getUTCFullYear()).toBe(2027);
    expect(rotationDateFor(entry({ purchasedAt: null }), 12)).toBeNull();
    expect(rotationDateFor(entry(), undefined)).toBeNull();
  });

  it('picks the earliest upcoming rotation and flags overdue items', () => {
    const entries = {
      water: entry({ itemId: 'water', purchasedAt: '2025-03-01T00:00:00.000Z' }), // 12 mo → overdue
      food: entry({ itemId: 'food', purchasedAt: '2026-01-15T00:00:00.000Z' }), // 12 mo → future
      cash: entry({ itemId: 'cash', purchasedAt: '2025-01-01T00:00:00.000Z' }), // no shelf life → ignored
    };
    const shelfLifeFor = (id: string) => ({ water: 12, food: 12 }[id]);
    const next = nextRotation(entries, shelfLifeFor, now);
    expect(next).toMatchObject({ itemId: 'water', overdue: true });
    expect(isRotationDue(entries, shelfLifeFor, now)).toBe(true);
    expect(nextRotation(entries, shelfLifeFor, new Date('2025-06-01T00:00:00.000Z'))).toMatchObject({ itemId: 'water', overdue: false });
  });

  it('returns no rotation when nothing has a purchase date', () => {
    expect(isRotationDue({ water: entry({ purchasedAt: null }) }, () => 12, now)).toBe(false);
  });
});

describe('stamping rotation (R-INV-9)', () => {
  it('stamps a missing purchasedAt and records the rotation time', () => {
    const result = stampRotation({ water: entry({ purchasedAt: null }) }, ['water'], '2026-10-19T00:00:00.000Z');
    expect(result.entries.water.purchasedAt).toBe('2026-10-19T00:00:00.000Z');
    expect(result.lastRotationAt).toBe('2026-10-19T00:00:00.000Z');
  });

  it('creates a missing entry for a stamped item', () => {
    const result = stampRotation({}, ['water'], '2026-10-19T00:00:00.000Z');
    expect(result.entries.water).toMatchObject({ owned: true, purchasedAt: '2026-10-19T00:00:00.000Z', quantityOwned: 0 });
  });

  it('leaves dated entries alone and does not record a rotation', () => {
    const result = stampRotation({ water: entry({ purchasedAt: '2025-01-01T00:00:00.000Z' }) }, ['water'], '2026-10-19T00:00:00.000Z');
    expect(result.entries.water.purchasedAt).toBe('2025-01-01T00:00:00.000Z');
    expect(result.lastRotationAt).toBeNull();
  });
});

describe('orphan entries (R-INV-1)', () => {
  it('lists entries whose kit line no longer exists', () => {
    const orphans = orphanEntries({ water: entry(), firstAid: entry({ itemId: 'first-aid' }) }, ['water']);
    expect(orphans.map(entry => entry.itemId)).toEqual(['first-aid']);
  });
});
