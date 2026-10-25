import type { DrillAnswer, DrillResult } from '../plan-schema';
import { DRILLS, type DrillDefinition, type DrillStep } from './drills';

/**
 * F08 — drill scoring and records (pure).
 *
 * "Not yet" produces a suggested task the user must choose to add (R-DRL-2).
 * The score copy is encouraging and neutral: "4 of 6 — two things to pick
 * up" (R-DRL-3). The drill due check is a 60-day prompt, not a nag.
 */

export function drillById(id: string): DrillDefinition | null {
  return DRILLS.find(drill => drill.id === id) ?? null;
}

export function scoreDrill(definition: DrillDefinition, answers: Record<string, DrillAnswer>) {
  const answered = definition.steps.map(step => answers[step.id] ?? 'skipped');
  const ready = answered.filter(answer => answer === 'ready').length;
  const notYet = answered.filter(answer => answer === 'not-yet').length;
  const skipped = answered.filter(answer => answer === 'skipped').length;
  const total = definition.steps.length;
  return { total, ready, notYet, skipped, skippedAll: ready === 0 && notYet === 0 && skipped > 0 };
}

export function suggestedTasksFor(definition: DrillDefinition, answers: Record<string, DrillAnswer>): { title: string; detail: string; category: string }[] {
  return definition.steps
    .filter(step => answers[step.id] === 'not-yet' && step.taskLink)
    .flatMap(step => step.taskLink ? [{ ...step.taskLink }] : []);
}

export function drillScoreSummary(result: DrillResult): string {
  const definition = drillById(result.drillId);
  if (!definition) return '';
  const { ready, total } = scoreDrill(definition, result.answers);
  const gap = total - ready;
  if (gap === 0) return `${ready} of ${total} — everything ready.`;
  return `${ready} of ${total} — ${gap} ${gap === 1 ? 'thing' : 'things'} to pick up.`;
}

/**
 * R-DRL-9: the record text contains the date, the drill name, the score, and
 * the "not yet" items — and nothing else from the plan.
 */
export function drillRecordText(result: DrillResult): string {
  const definition = drillById(result.drillId);
  const title = definition?.title ?? result.drillId;
  const date = new Date(result.completedAt);
  const day = Number.isNaN(date.getTime())
    ? result.completedAt
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const lines = [`StormReady drill · ${title}`, `${day}: ${drillScoreSummary(result)}`];
  const notYet = suggestedTasksFor(definition ?? { id: '', title: '', scenario: '', minutes: 3, steps: [], debrief: '' }, result.answers);
  if (notYet.length) {
    lines.push('Not yet:', ...notYet.map(task => `- ${task.title}`));
  }
  return lines.join('\n');
}

export function lastDrill(results: DrillResult[]): DrillResult | null {
  if (!results.length) return null;
  const sorted = [...results].sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  return sorted[0];
}

export function daysSinceDrill(results: DrillResult[], now: Date): number | null {
  const previous = lastDrill(results);
  if (!previous) return null;
  const then = new Date(previous.completedAt);
  if (Number.isNaN(then.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / (24 * 60 * 60 * 1000)));
}

/** R-DRL-10: a gentle prompt after 60 days, gone the moment a drill is recorded. */
export function isDrillDue(results: DrillResult[], now: Date, days = 60): boolean {
  const since = daysSinceDrill(results, now);
  return since === null ? false : since >= days;
}
