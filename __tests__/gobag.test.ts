import {
  bagProgress,
  bagToText,
  createBag,
  missingLineIds,
  removeLineFromBag,
  setPackedFor,
  suggestedPersonalBags,
} from '../src/gobag/model';
import { BAG_TEMPLATES } from '../src/gobag/templates';
import { DEFAULT_HOUSEHOLD, type GoBag, type Household } from '../src/plan-schema';

function bag(overrides: Partial<GoBag> = {}): GoBag {
  return {
    id: 'b1',
    name: 'Personal go-bag',
    owner: '',
    location: 'By the door',
    template: 'personal',
    itemIds: ['water', 'food', 'missing-line'],
    packed: { water: true },
    note: '',
    createdAt: '2026-10-19T00:00:00.000Z',
    ...overrides,
  };
}

const kitLines = [
  { id: 'water', label: 'Drinking water', quantity: 14, unit: 'gal', unitPlural: 'gal' },
  { id: 'food', label: 'Shelf-stable food', quantity: 14, unit: 'person-day', unitPlural: 'person-days' },
];

describe('bag templates', () => {
  it('covers every template with real kit line ids (R-BAG-2)', () => {
    for (const definition of Object.values(BAG_TEMPLATES)) {
      expect(definition.title).toBeTruthy();
      expect(definition.scenario).toBeTruthy();
      expect(Array.isArray(definition.itemIds)).toBe(true);
    }
    expect(BAG_TEMPLATES.custom.itemIds).toEqual([]);
  });

  it('falls back to the template title when the name is blank', () => {
    expect(createBag('vehicle', { id: 'x', name: '   ', createdAt: 'now' }).name).toBe('Vehicle kit');
    expect(createBag('custom', { id: 'x', name: 'Office bag', owner: ' Sam ', location: ' Desk ', createdAt: 'now' })).toMatchObject({
      name: 'Office bag', owner: 'Sam', location: 'Desk', template: 'custom', packed: {}, itemIds: [],
    });
  });
});

describe('suggested personal bags (R-BAG-7)', () => {
  it('suggests one bag per person', () => {
    const bags = suggestedPersonalBags({ ...DEFAULT_HOUSEHOLD, people: 3 }, index => `bag-${index}`, 'now');
    expect(bags).toHaveLength(3);
    expect(bags[0]).toMatchObject({ name: 'Personal go-bag', template: 'personal' });
    expect(bags[1].name).toBe('Personal go-bag 2');
    expect(bags.every(bag => bag.itemIds.length > 0)).toBe(true);
  });

  it('clamps the count to the household limit', () => {
    expect(suggestedPersonalBags({ ...DEFAULT_HOUSEHOLD, people: 99 }, i => `b${i}`, 'now')).toHaveLength(20);
  });
});

describe('bag lines and progress (R-BAG-1, R-BAG-3)', () => {
  it('reports missing kit lines without dropping them (R-BAG-1)', () => {
    expect(missingLineIds(bag(), kitLines.map(line => line.id))).toEqual(['missing-line']);
    expect(missingLineIds(bag(), ['water', 'food', 'missing-line'])).toEqual([]);
  });

  it('derives progress, with null percent for an empty bag', () => {
    expect(bagProgress(bag())).toMatchObject({ total: 3, packed: 1, percent: 33, packedList: ['water'] });
    const empty = bagProgress(bag({ itemIds: [] }));
    expect(empty.percent).toBeNull();
    expect(empty.total).toBe(0);
  });

  it('packs and unpacks lines explicitly', () => {
    expect(setPackedFor(bag(), 'food', true).packed.food).toBe(true);
    expect(setPackedFor(bag(), 'water', false).packed.water).toBeUndefined();
  });

  it('removes lines and cleans packed state', () => {
    const withoutWater = removeLineFromBag(bag(), 'water');
    expect(withoutWater.itemIds).toEqual(['food', 'missing-line']);
    expect(withoutWater.packed.water).toBeUndefined();
  });
});

describe('bag share text (R-BAG-5, R-BAG-11)', () => {
  const household: Household = { ...DEFAULT_HOUSEHOLD, people: 4, days: 7 };

  it('contains bag contents and quantities but never plan details', () => {
    const text = bagToText(bag({ owner: 'Rita', note: 'Check the dates' }), kitLines, household);
    expect(text).toContain('StormReady go-bag · Personal go-bag');
    expect(text).toContain('Owner: Rita');
    expect(text).toContain('Kept: By the door');
    expect(text).toContain('☑ Drinking water — 14 gal');
    expect(text).toContain('☐ Shelf-stable food — 14 person-days');
    expect(text).toContain('Not in your current kit');
    expect(text).toContain('4 people · 7 days');
    // R-BAG-11: no zone, contact, or medical leakage
    expect(text).not.toMatch(/zone|Zone|medication|Dr\.|county/i);
  });

  it('states a bag with nothing chosen', () => {
    const text = bagToText(createBag('custom', { id: 'c', name: '', createdAt: 'now' }), [], household);
    expect(text).toContain('(no items chosen yet)');
  });
});
