/**
 * Client-side, locally unique ids for user-created plan entries (go-bags,
 * medications, contacts, drill results, suggested tasks). No server, no uuid
 * library, no global counter — collisions would require identical names to
 * the tenth of a millisecond plus the same random suffix.
 */
export function newId(prefix: string): string {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${time}-${random}`;
}
