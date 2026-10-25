import React, { createContext, createElement, useCallback, useContext, useMemo } from 'react';
import { useAppTheme } from '../theme';
import { en, type TranslationKey } from './en';
import { es } from './es';

export type Locale = 'en' | 'es';

/**
 * Creates the lookup for one locale. The English table is the source of truth
 * for the key set (R-L10-2); a key missing from the Spanish table falls back
 * to English and the key-parity unit test keeps the two tables in step.
 */
export function translator(locale: Locale) {
  return (key: TranslationKey): string => {
    if (locale === 'es') {
      const value = (es as Record<string, string | undefined>)[key];
      if (typeof value === 'string') return value;
    }
    return en[key];
  };
}

export type TParams = Record<string, string | number>;

/** Replaces named `{placeholders}`; Spanish word order may move them freely. */
export function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

const LocaleContext = createContext<Locale>('en');

export function I18nProvider({ children }: React.PropsWithChildren) {
  const { effectiveLocale } = useAppTheme();
  return createElement(LocaleContext.Provider, { value: effectiveLocale }, children);
}

/**
 * The one translation hook every screen uses. Switching the locale in
 * Settings re-renders every mounted screen immediately — no restart (F10).
 */
export function useT() {
  const locale = useContext(LocaleContext);
  const t = useCallback((key: TranslationKey, params?: TParams) => interpolate(translator(locale)(key), params), [locale]);
  return { t, locale };
}

/** A pure translator for places that cannot call hooks (share text builders). */
export function translateFor(locale: Locale) {
  return (key: TranslationKey, params?: TParams) => interpolate(translator(locale)(key), params);
}

export type { TranslationKey };
export { en, es };
