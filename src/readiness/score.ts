import { effectiveMedicalNeeds, isMedicalPlanEmpty, visibleTasks, type CommunicationPlan, type DrillResult, type GoBagState, type Household, type InventoryState, type MedicalPlan, type Task, type VerifiedZone } from '../plan-schema';
import { commsCompletion, hasOutOfAreaContact } from '../comms/model';
import { isZoneStale } from '../zone/verification';
import { bagProgress } from '../gobag/model';
import { coverageFor, expiredItems, expiringItems } from '../inventory/model';
import { daysSinceDrill } from '../scenarios/model';

/**
 * F09 — Readiness Score (pure, derived, never stored — R-RDY-1).
 *
 * A 0–100 score shown as a band, never an opaque number (R-RDY-7). Weights
 * are constants in this file (R-RDY-4); the breakdown is always available
 * through `factors`. No points, levels, badges, or streaks (R-DRL/R-RDY-6):
 * the score describes the plan, not the person.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const READINESS_WEIGHTS = {
  checklist: 18,
  coverage: 16,
  expiry: 7,
  zone: 12,
  goBags: 10,
  communication: 12,
  medical: 8,
  drills: 7,
  kitReview: 6,
} as const;

export type ReadinessFactor = {
  id: string;
  label: string;
  /** 0..1 */
  earned: number;
  weight: number;
  reason: string;
  /** Locale-independent key for the translation table, e.g. `readiness.factor.checklist.reason`. */
  reasonKey?: string;
  /** Values for the `{placeholders}` in the translated reason. */
  reasonParams?: Record<string, string | number>;
  action?: { label: string; route: string };
};

export type ReadinessBand = 'ready' | 'almost' | 'attention' | 'starting';

export type ReadinessScore = {
  total: number;
  band: ReadinessBand;
  factors: ReadinessFactor[];
  topGaps: ReadinessFactor[];
};

export type ReadinessInput = {
  household: Household;
  tasks: Task[];
  kitLines: { id: string; quantity: number; unit: string }[];
  inventory: InventoryState;
  zone: VerifiedZone;
  goBags: GoBagState;
  medical: MedicalPlan;
  communication: CommunicationPlan;
  drills: DrillResult[];
};

export const READY_BANDS: Record<ReadinessBand, { range: [number, number]; label: string; copy: string }> = {
  ready: { range: [85, 100], label: 'Ready', copy: 'Your plan is complete and current. Keep it fresh.' },
  almost: { range: [55, 84], label: 'Almost there', copy: 'A few things would make this plan dependable.' },
  attention: { range: [30, 54], label: 'Needs attention', copy: 'Your plan has gaps. Start with the item below.' },
  starting: { range: [0, 29], label: 'Just getting started', copy: 'Pick one step this week. It adds up fast.' },
};

export function bandForScore(total: number): ReadinessBand {
  if (total >= READY_BANDS.ready.range[0]) return 'ready';
  if (total >= READY_BANDS.almost.range[0]) return 'almost';
  if (total >= READY_BANDS.attention.range[0]) return 'attention';
  return 'starting';
}

function zoneAgeDays(zone: VerifiedZone, now: Date): number {
  if (!zone.verifiedAt) return 90;
  const then = new Date(zone.verifiedAt).getTime();
  if (Number.isNaN(then)) return 90;
  return Math.max(0, Math.floor((now.getTime() - then) / DAY_MS));
}

function checklistFactor(input: ReadinessInput): ReadinessFactor {
  const visible = visibleTasks(input.tasks, input.household);
  const done = visible.filter(task => task.done).length;
  return {
    id: 'checklist',
    label: 'Checklist',
    earned: visible.length ? done / visible.length : 0,
    weight: READINESS_WEIGHTS.checklist,
    reason: `${done} of ${visible.length} checklist steps done`,
    reasonKey: 'readiness.factor.checklist.reason',
    reasonParams: { done, visible: visible.length },
    action: { label: 'Open my checklist', route: '/(tabs)/plan' },
  };
}

function coverageFactor(input: ReadinessInput): ReadinessFactor {
  const water = coverageFor(input.kitLines, input.inventory).find(line => line.itemId === 'water');
  const owned = water?.owned ?? 0;
  const required = water?.required ?? 0;
  const percent = water && water.percent !== null ? water.percent : 0;
  return {
    id: 'coverage',
    label: 'Kit coverage (water and food)',
    earned: Math.min(1, percent / 100),
    weight: READINESS_WEIGHTS.coverage,
    reason: required > 0
      ? `You have ${owned} of the ${required} gallons your plan needs`
      : 'There is no water requirement yet',
    reasonKey: required > 0 ? 'readiness.factor.coverage.reason' : 'readiness.factor.coverage.none',
    reasonParams: { owned, required },
    action: { label: 'Update my inventory', route: '/inventory' },
  };
}

function expiryFactor(input: ReadinessInput, now: Date): ReadinessFactor | null {
  const owned = Object.values(input.inventory.entries).filter(entry => entry.owned);
  if (!owned.length) return null;
  const expired = expiredItems(input.inventory.entries, now);
  const expiring = expiringItems(input.inventory.entries, now);
  const earned = Math.max(0, (owned.length - expired.length - expiring.length * 0.5) / owned.length);
  const parts: string[] = [];
  if (expired.length) parts.push(`${expired.length} expired`);
  if (expiring.length) parts.push(`${expiring.length} expiring soon`);
  return {
    id: 'expiry',
    label: 'Expiry and rotation',
    earned,
    weight: READINESS_WEIGHTS.expiry,
    reason: parts.length
      ? `Your kit has ${parts.join(' and ')} — the replace-now list is one tap away.`
      : 'Nothing in your kit is expired or expiring.',
    reasonKey: parts.length ? 'readiness.factor.expiry.problems' : 'readiness.factor.expiry.clean',
    reasonParams: { expired: expired.length, expiring: expiring.length },
    action: { label: 'Open the replace-now list', route: '/inventory' },
  };
}

function zoneFactor(input: ReadinessInput, now: Date): ReadinessFactor {
  const zone = input.zone;
  const recorded = Boolean(zone.value.trim());
  const stale = recorded && isZoneStale(zone, now);
  const earned = !recorded ? 0 : (zone.source === 'none' ? 0.5 : 1) * (stale ? 0.5 : 1);
  return {
    id: 'zone',
    label: 'Evacuation zone on record',
    earned,
    weight: READINESS_WEIGHTS.zone,
    reason: !recorded
      ? 'No zone recorded yet'
      : stale
        ? `Your zone was verified ${zoneAgeDays(zone, now)} days ago — it may be out of date`
        : 'Your zone is recorded and less than 90 days old',
    reasonKey: !recorded ? 'readiness.factor.zone.none' : stale ? 'readiness.factor.zone.stale' : 'readiness.factor.zone.fresh',
    reasonParams: { days: zoneAgeDays(zone, now) ?? 0 },
    action: { label: 'Record or review my zone', route: '/(tabs)/plan' },
  };
}

function goBagFactor(input: ReadinessInput): ReadinessFactor {
  const bags = input.goBags.bags;
  if (!bags.length) {
    return {
      id: 'goBags',
      label: 'Go-bags',
      earned: 0,
      weight: READINESS_WEIGHTS.goBags,
      reason: 'No go-bags yet — one per person is the usual pattern',
      reasonKey: 'readiness.factor.goBags.none',
      action: { label: 'Build a go-bag', route: '/go-bags' },
    };
  }
  const percents = bags.map(bag => bagProgress(bag).percent ?? 0);
  const average = percents.reduce((sum, value) => sum + value, 0) / percents.length;
  return {
    id: 'goBags',
    label: 'Go-bags packed',
    earned: Math.min(1, average / 100),
    weight: READINESS_WEIGHTS.goBags,
    reason: bags.length === 1
      ? `1 bag is ${Math.round(average)}% packed`
      : `${bags.length} bags average ${Math.round(average)}% packed`,
    reasonKey: bags.length === 1 ? 'readiness.factor.goBags.one' : 'readiness.factor.goBags.many',
    reasonParams: { count: bags.length, percent: Math.round(average) },
    action: { label: 'Open my go-bags', route: '/go-bags' },
  };
}

function communicationFactor(input: ReadinessInput): ReadinessFactor {
  const plan = input.communication;
  const earned = commsCompletion(plan) / 100;
  const contactDone = hasOutOfAreaContact(plan);
  const meetingDone = Boolean(plan.meetingPoint.label.trim() || plan.meetingPoint.address.trim());
  const reasonKey = !contactDone && !meetingDone
    ? 'readiness.factor.communication.none'
    : contactDone && meetingDone
      ? 'readiness.factor.communication.both'
      : contactDone
        ? 'readiness.factor.communication.contactOnly'
        : 'readiness.factor.communication.meetingOnly';
  return {
    id: 'communication',
    label: 'Communication plan',
    earned,
    weight: READINESS_WEIGHTS.communication,
    reason: !contactDone && !meetingDone
      ? 'No out-of-area contact and no meeting point recorded'
      : contactDone && meetingDone
        ? 'An out-of-area contact and a meeting point are on record'
        : contactDone
          ? 'Contact recorded — a meeting point would complete the plan'
          : 'Meeting point recorded — an out-of-area contact is the bigger gap',
    reasonKey,
    action: { label: 'Write my communication plan', route: '/communication' },
  };
}

function medicalFactor(input: ReadinessInput): ReadinessFactor | null {
  if (!effectiveMedicalNeeds(input.household, input.medical)) return null;
  const empty = isMedicalPlanEmpty(input.medical);
  return {
    id: 'medical',
    label: 'Medical plan',
    earned: empty ? 0 : 1,
    weight: READINESS_WEIGHTS.medical,
    reason: empty
      ? 'The household has medical needs but the medical plan is empty'
      : 'A medical plan is on record — keep it current with your clinician',
    reasonKey: empty ? 'readiness.factor.medical.empty' : 'readiness.factor.medical.recorded',
    action: { label: 'Open my medical plan', route: '/medical' },
  };
}

function drillFactor(input: ReadinessInput, now: Date): ReadinessFactor {
  const since = daysSinceDrill(input.drills, now);
  const earned = since === null ? 0 : since < 60 ? 1 : since < 120 ? 0.5 : 0;
  return {
    id: 'drills',
    label: 'Practise',
    earned,
    weight: READINESS_WEIGHTS.drills,
    reason: since === null
      ? 'No drill completed yet — a ten-minute practice run counts'
      : `Last drill ${since} ${since === 1 ? 'day' : 'days'} ago`,
    reasonKey: since === null ? 'readiness.factor.drills.none' : 'readiness.factor.drills.recent',
    reasonParams: { days: since ?? 0 },
    action: { label: 'Run a drill', route: '/drill' },
  };
}

function kitReviewFactor(input: ReadinessInput, now: Date): ReadinessFactor {
  const review = input.inventory.lastRotationAt;
  if (!review) {
    return {
      id: 'kitReview',
      label: 'Kit review recency',
      earned: 0.5,
      weight: READINESS_WEIGHTS.kitReview,
      reason: 'Your kit has never been rotated — a seasonal refresh keeps water and food current',
      reasonKey: 'readiness.factor.kitReview.never',
      action: { label: 'Review my kit', route: '/kit' },
    };
  }
  const then = new Date(review).getTime();
  const fresh = !Number.isNaN(then) && now.getTime() - then <= 365 * DAY_MS;
  return {
    id: 'kitReview',
    label: 'Kit review recency',
    earned: fresh ? 1 : 0.5,
    weight: READINESS_WEIGHTS.kitReview,
    reason: fresh
      ? 'Your kit was reviewed within the last 12 months'
      : 'Your kit has not been reviewed in over a year',
    reasonKey: fresh ? 'readiness.factor.kitReview.fresh' : 'readiness.factor.kitReview.old',
    action: { label: 'Review my kit', route: '/kit' },
  };
}

/**
 * The full, honest score. Every factor records its reason; the three
 * highest-impact gaps are the first thing the breakdown screen shows.
 */
export function readinessScore(input: ReadinessInput, now: Date = new Date()): ReadinessScore {
  const factors = [
    checklistFactor(input),
    coverageFactor(input),
  ];

  const expiry = expiryFactor(input, now);
  if (expiry) factors.push(expiry);
  const medical = medicalFactor(input);
  if (medical) factors.push(medical);
  factors.push(
    zoneFactor(input, now),
    goBagFactor(input),
    communicationFactor(input),
    drillFactor(input, now),
    kitReviewFactor(input, now),
  );

  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const earnedWeight = factors.reduce((sum, factor) => sum + factor.earned * factor.weight, 0);
  const total = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 0;
  const topGaps = [...factors]
    .filter(factor => factor.earned < 1)
    .sort((a, b) => a.earned - b.earned || b.weight - a.weight)
    .slice(0, 3);

  return { total, band: bandForScore(total), factors, topGaps };
}
