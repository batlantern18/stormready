/**
 * Locale-aware date formatting (R-L10-4): the active locale is passed
 * explicitly with an Intl tag, never the device default.
 */

export type Locale = 'en' | 'es';

const TAGS: Record<Locale, string> = { en: 'en-US', es: 'es-MX' };

/** "March 3, 2026" in English; "3 de marzo de 2026" in Spanish (R-L10-11). */
export function formatDate(value: string | Date | null | undefined, locale: Locale): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : '';
  return new Intl.DateTimeFormat(TAGS[locale], { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

/** "Oct 19, 2026" / "19 oct 2026" — compact form for lists. */
export function formatDateShort(value: string | Date | null | undefined, locale: Locale): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : '';
  return new Intl.DateTimeFormat(TAGS[locale], { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

/** Full date and clock time, e.g. "Oct 19, 2026, 2:05 PM" / "19 oct 2026, 14:05". */
export function formatDateTime(value: string | Date | null | undefined, locale: Locale): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : '';
  return new Intl.DateTimeFormat(TAGS[locale], {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
}
