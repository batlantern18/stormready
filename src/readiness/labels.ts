import { type SeasonId } from './season';
import { type TranslationKey } from '../i18n';

/**
 * F09 — the screen-facing translation keys for readiness factors, bands, and
 * seasons. The score module stays locale-independent (`reasonKey` is a plain
 * string); screens map ids → keys here so nothing drifts.
 */
export const FACTOR_LABEL_KEYS: Record<string, TranslationKey> = {
  checklist: 'readiness.factor.checklist.label',
  coverage: 'readiness.factor.coverage.label',
  expiry: 'readiness.factor.expiry.label',
  zone: 'readiness.factor.zone.label',
  goBags: 'readiness.factor.goBags.label',
  communication: 'readiness.factor.communication.label',
  medical: 'readiness.factor.medical.label',
  drills: 'readiness.factor.drills.label',
  kitReview: 'readiness.factor.kitReview.label',
};

export const BAND_LABEL_KEYS = {
  ready: 'readiness.band.ready.label',
  almost: 'readiness.band.almost.label',
  attention: 'readiness.band.attention.label',
  starting: 'readiness.band.starting.label',
} as const;

export const BAND_COPY_KEYS = {
  ready: 'readiness.band.ready.copy',
  almost: 'readiness.band.almost.copy',
  attention: 'readiness.band.attention.copy',
  starting: 'readiness.band.starting.copy',
} as const;

export const BAND_TONES = { ready: 'green', almost: 'blue', attention: 'amber', starting: 'amber' } as const;

export const SEASON_LABEL: Record<SeasonId, TranslationKey> = {
  hurricane: 'readiness.season.hurricane.label',
  wildfire: 'readiness.season.wildfire.label',
  winter: 'readiness.season.winter.label',
};
