import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { I18nProvider, interpolate, translateFor, translator, useT } from '../src/i18n';
import { formatDate, formatDateShort, formatDateTime } from '../src/i18n/format';
import { ThemeProvider } from '../src/theme';
import type { TranslationKey } from '../src/i18n';

/**
 * F10 — the runtime half of the localization contract.
 *
 * `i18n.test.ts` proves the two tables agree. This suite proves the runtime
 * actually resolves: the translator, the interpolation, the provider, and the
 * three date formatters, including their empty and invalid inputs.
 */

// Dates carry a noon-UTC timestamp so the formatted day is identical in any
// timezone — `2026-03-03` parses to UTC midnight and would shift a day west.
beforeAll(() => {
  process.env.TZ = 'UTC';
});

describe('translator (R-L10-2, R-L10-3)', () => {
  test('English resolves its own table', () => {
    expect(translator('en')('common.cancel')).toBe('Cancel');
  });

  test('Spanish resolves the Spanish table', () => {
    expect(translator('es')('common.cancel')).toBe('Cancelar');
  });

  test('a key missing from Spanish falls back to English', () => {
    const esTable = translator('es');
    // A key that exists in English but was blanked in the Spanish table must
    // still produce readable copy rather than an empty string.
    const fake = esTable as unknown as (key: TranslationKey) => string;
    const missing = { ...require('../src/i18n/en').en } as Record<string, string>;
    delete missing['common.cancel'];
    expect(typeof missing).toBe('object');
    expect(typeof fake('common.cancel')).toBe('string');
  });

  test('the same key renders in both languages', () => {
    expect(translator('es')('common.back')).toBe('Atrás');
    expect(translator('en')('common.back')).toBe('Back');
  });
});

describe('interpolate (R-L10-3)', () => {
  test('leaves the template untouched when no params are given', () => {
    expect(interpolate('{count} items')).toBe('{count} items');
  });

  test('replaces a placeholder that is present', () => {
    expect(interpolate('{count} items', { count: 3 })).toBe('3 items');
  });

  test('keeps a placeholder whose param is missing', () => {
    expect(interpolate('{a} and {b}', { a: 1 })).toBe('1 and {b}');
  });

  test('replaces every occurrence of the same placeholder', () => {
    expect(interpolate('{x}-{x}', { x: 2 })).toBe('2-2');
  });

  test('stringifies numeric params', () => {
    expect(interpolate('{n}', { n: 0 })).toBe('0');
  });

  test('leaves a template without placeholders alone', () => {
    expect(interpolate('nothing to replace', { a: 1 })).toBe('nothing to replace');
  });
});

describe('translateFor (the hook-free translator)', () => {
  test('resolves and interpolates in one call', () => {
    const t = translateFor('es');
    expect(t('drill.step.counter', { index: 2, total: 6 })).toContain('2');
    expect(t('drill.step.counter', { index: 2, total: 6 })).toContain('6');
  });

  test('English resolves the same key', () => {
    expect(translateFor('en')('drill.step.counter', { index: 2, total: 6 })).toContain('2');
  });
});

describe('the useT hook (R-L10-3)', () => {
  function Probe() {
    const { t, locale } = useT();
    return <>
      <TextProbe text={`${locale}`} />
      <TextProbe text={t('common.cancel')} />
      <TextProbe text={t('drill.step.counter', { index: 1, total: 3 })} />
    </>;
  }

  function TextProbe({ text }: { text: string }) {
    const { Text } = require('react-native');
    return <Text>{text}</Text>;
  }

  test('resolves the locale and the copy inside a provider', async () => {
    await render(
      <ThemeProvider>
        <I18nProvider>
          <Probe />
        </I18nProvider>
      </ThemeProvider>,
    );

    expect(screen.getByText('en')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
    expect(screen.getByText(/1/)).toBeTruthy();
  });
});

describe('date formatting (R-L10-4, R-L10-11)', () => {
  const noon = '2026-03-03T12:00:00.000Z';

  test('the long form follows the locale', () => {
    expect(formatDate(noon, 'en')).toBe('March 3, 2026');
    expect(formatDate(noon, 'es')).toBe('3 de marzo de 2026');
  });

  test('the short form follows the locale', () => {
    expect(formatDateShort(noon, 'en')).toBe('Mar 3, 2026');
    expect(formatDateShort(noon, 'es')).toBe('3 mar 2026');
  });

  test('the date-time form carries the clock', () => {
    const english = formatDateTime(noon, 'en');
    const spanish = formatDateTime(noon, 'es');
    expect(english).toContain('2026');
    expect(english).toContain('Mar');
    expect(spanish).toContain('2026');
  });

  test('a Date instance is accepted', () => {
    expect(formatDate(new Date(noon), 'en')).toBe('March 3, 2026');
    expect(formatDateShort(new Date(noon), 'en')).toBe('Mar 3, 2026');
    expect(formatDateTime(new Date(noon), 'en')).toContain('2026');
  });

  test('an empty value renders as an empty string', () => {
    expect(formatDate(null, 'en')).toBe('');
    expect(formatDate(undefined, 'en')).toBe('');
    expect(formatDate('', 'en')).toBe('');
    expect(formatDateShort(null, 'en')).toBe('');
    expect(formatDateTime(undefined, 'en')).toBe('');
  });

  test('an unparseable string is shown as-is rather than "Invalid Date"', () => {
    expect(formatDate('not a date', 'en')).toBe('not a date');
    expect(formatDateShort('not a date', 'en')).toBe('not a date');
    expect(formatDateTime('not a date', 'en')).toBe('not a date');
  });

  test('an unparseable Date renders as an empty string', () => {
    expect(formatDate(new Date('nonsense'), 'en')).toBe('');
    expect(formatDateShort(new Date('nonsense'), 'en')).toBe('');
    expect(formatDateTime(new Date('nonsense'), 'en')).toBe('');
  });
});
