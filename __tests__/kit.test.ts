import { DEFAULT_HOUSEHOLD, type Household } from '../src/plan-schema';
import { calculateKit, groupKitLines, kitSummary } from '../src/kit/calculator';
import { CATEGORY_ORDER } from '../src/kit/catalog';
import { formatGallons, formatQuantity, householdSummary, kitToText } from '../src/kit/format';

function household(overrides: Partial<Household> = {}): Household {
  return { ...DEFAULT_HOUSEHOLD, ...overrides };
}

describe('calculateKit', () => {
  it('sizes water and food from people and days', () => {
    const lines = calculateKit(household({ people: 4, days: 10 }));
    expect(lines.find(line => line.id === 'water')?.quantity).toBe(40);
    expect(lines.find(line => line.id === 'food')?.quantity).toBe(40);
  });

  it('includes conditional lines only when they apply', () => {
    const base = calculateKit(household());
    expect(base.some(line => line.id === 'infant-supplies')).toBe(false);
    expect(base.some(line => line.id === 'medication')).toBe(false);
    expect(base.some(line => line.id === 'pet-supplies')).toBe(false);
    expect(base.some(line => line.id === 'access-supplies')).toBe(false);

    const lines = calculateKit(household({
      infants: 2,
      medicalNeeds: true,
      pets: true,
      petCount: 3,
      accessibilityNeeds: true,
      days: 7,
    }));
    expect(lines.find(line => line.id === 'infant-supplies')?.quantity).toBe(14);
    expect(lines.find(line => line.id === 'medication')?.quantity).toBe(7);
    expect(lines.find(line => line.id === 'pet-supplies')?.quantity).toBe(21);
    expect(lines.find(line => line.id === 'access-supplies')?.quantity).toBe(1);
  });

  it('gives every line an explanation and an official source', () => {
    const lines = calculateKit(household({ infants: 1, medicalNeeds: true, pets: true, petCount: 1, accessibilityNeeds: true }));
    expect(lines.length).toBeGreaterThan(10);
    for (const line of lines) {
      expect(line.quantity).toBeGreaterThan(0);
      expect(Number.isFinite(line.quantity)).toBe(true);
      expect(line.basis.trim().length).toBeGreaterThan(0);
      expect(line.source.label.trim().length).toBeGreaterThan(0);
      expect(line.source.url).toMatch(/^https:\/\//);
      expect(CATEGORY_ORDER).toContain(line.category);
    }
  });

  it('groups lines in catalog category order', () => {
    const groups = groupKitLines(calculateKit(household({ pets: true, petCount: 1 })));
    const categories = [...groups.keys()];
    expect(categories).toEqual(CATEGORY_ORDER.filter(category => groups.has(category)));
  });

  it('summarizes the kit for the home screen', () => {
    const summary = kitSummary(household({ people: 2, days: 7 }));
    expect(summary.itemCount).toBe(summary.lines.length);
    expect(summary.waterGallons).toBe(14);
    expect(summary.foodPersonDays).toBe(14);
  });
});

describe('kit formatting', () => {
  it('formats singular and plural units', () => {
    expect(formatQuantity({ quantity: 1, unit: 'kit', unitPlural: 'kits' })).toBe('1 kit');
    expect(formatQuantity({ quantity: 3, unit: 'kit', unitPlural: 'kits' })).toBe('3 kits');
    expect(formatQuantity({ quantity: 1.25, unit: 'gal', unitPlural: 'gal' })).toBe('1.3 gal');
  });

  it('formats gallons without unnecessary decimals', () => {
    expect(formatGallons(14)).toBe('14 gal');
    expect(formatGallons(14.25)).toBe('14.3 gal');
  });

  it('summarizes household details with correct plurals', () => {
    expect(householdSummary(household({ people: 1, infants: 0, days: 7 }))).toBe('1 person · 7 days');
    expect(householdSummary(household({ people: 2, infants: 1, pets: true, petCount: 1, days: 10 })))
      .toBe('2 people · 1 infant · 1 pet · 10 days');
    expect(householdSummary(household({ people: 3, infants: 2, pets: true, petCount: 4, days: 7 })))
      .toBe('3 people · 2 infants · 4 pets · 7 days');
  });

  it('shares a plain-text list with sources and a disclaimer', () => {
    const home = household({ people: 2, days: 7 });
    const text = kitToText(calculateKit(home), home, new Date('2026-10-19T12:00:00Z'));
    expect(text).toContain('StormReady emergency kit');
    expect(text).toContain('Household: 2 people · 7 days');
    expect(text).toContain('WATER');
    expect(text).toContain('- 14 gal — Drinking water');
    expect(text).toContain('Why: 2 people × 7 days × 1 gallon per person per day');
    expect(text).toContain('https://www.ready.gov/water');
    expect(text).toContain('not an official requirement');
    expect(text).toContain('not an emergency alert authority');
    expect(text).not.toContain('undefined');
  });
});
