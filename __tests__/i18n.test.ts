import { en, es, interpolate, type TranslationKey } from '../src/i18n';
import { formatDate, formatDateShort } from '../src/i18n/format';

// The date assertions assume UTC so the suite is deterministic on any machine.
beforeAll(() => {
  process.env.TZ = 'UTC';
});

/**
 * F10 / R-L10-2: the English table is the source of truth for the key set and
 * the Spanish table must carry every key; the placeholder sets of a key must
 * match between the two locales, because callers pass what they saw in code.
 */
describe('translation tables', () => {
  const esMap = es as Record<TranslationKey, string>;
  const enKeys = Object.keys(en) as TranslationKey[];
  const esKeys = Object.keys(esMap) as TranslationKey[];

  test('the Spanish table carries every English key', () => {
    const missing = enKeys.filter(key => !esKeys.includes(key));
    expect(missing).toEqual([]);
  });

  test('the Spanish table defines nothing the English table refuses', () => {
    const extra = esKeys.filter(key => !enKeys.includes(key));
    expect(extra).toEqual([]);
  });

  test('no key maps to an empty or whitespace value', () => {
    for (const key of enKeys) {
      expect(en[key].trim().length).toBeGreaterThan(0);
      expect(esMap[key].trim().length).toBeGreaterThan(0);
    }
  });

  test('every key exists in both tables with the same placeholders (R-L10-3)', () => {
    const placeholderPattern = /\{(\w+)\}/g;
    for (const key of enKeys) {
      const enSet = (en[key].match(placeholderPattern) ?? []).sort().join();
      const esSet = (esMap[key].match(placeholderPattern) ?? []).sort().join();
      expect({ key, enSet, esSet }).toEqual({ key, enSet, esSet });
    }
  });
});

describe('interpolation (R-L10-3)', () => {
  test('replaces named placeholders and leaves unknown ones', () => {
    expect(interpolate('{owned} of {required}', { owned: 3, required: 7 })).toBe('3 of 7');
    expect(interpolate('{name}?', {})).toBe('{name}?');
    expect(interpolate('plain')).toBe('plain');
  });

  test('placeholder sets match between locales for representative keys', () => {
    const esMap = es as Record<TranslationKey, string>;
    const pattern = /\{(\w+)\}/g;
    for (const key of ['inventory.coverage.missing', 'gobags.progress', 'plan.comms.parts', 'readiness.factor.checklist.reason', 'drill.step.counter'] as TranslationKey[]) {
      expect(esMap[key].match(pattern)?.sort()).toEqual(en[key].match(pattern)?.sort());
    }
  });
});

// Dates carry a noon-UTC timestamp so the formatted day is identical in any
// timezone — `2026-03-03` parses to UTC midnight and would shift a day west of it.
describe('localized dates (R-L10-6)', () => {
  test('March 3, 2026 renders per locale', () => {
    expect(formatDate('2026-03-03T12:00:00.000Z', 'en')).toBe('March 3, 2026');
    expect(formatDate('2026-03-03T12:00:00.000Z', 'es')).toBe('3 de marzo de 2026');
  });

  test('the short form follows the same split', () => {
    expect(formatDateShort('2026-03-03T12:00:00.000Z', 'en')).toBe('Mar 3, 2026');
    expect(formatDateShort('2026-03-03T12:00:00.000Z', 'es')).toBe('3 mar 2026');
  });
});
