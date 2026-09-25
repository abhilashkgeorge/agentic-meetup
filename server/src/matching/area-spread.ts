/**
 * Which neighbourhood a synthetic person belongs in, decided from their own id.
 *
 * WHY FROM THE ID. The synthetics in the database were seeded before areas existed,
 * so every Bangalore one sits on the city centre and the roster -- which reads the
 * tile off the point -- reports all of them as MG Road. Backfilling them needs a
 * choice per person, and a choice made from a running counter or the clock cannot be
 * re-run: a second pass would shuffle the city, and nobody could tell a re-run from a
 * bug. Hashing the id makes the backfill idempotent and diffable.
 *
 * The distribution is the generator's own (`AREA_DIST`), hole included, so a
 * backfilled crowd and a freshly seeded one are drawn from the same city.
 */
import { AREA_DIST, AREA_SILENT } from './synthetic.js';
import { pick } from './marginals.js';

/** FNV-1a. Small, stable across runs and versions, and not trying to be a hash. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** A uniform in [0, 1) from a string, with a salt so two draws are independent. */
const unit = (s: string): number => fnv1a(s) / 4294967296;

/**
 * The neighbourhood for this user, or null for the one in twelve who never says.
 *
 * Null is not a failure and is not MG Road: it is a person who has not answered, and
 * the point they already stand on is left exactly where it is.
 */
export function areaForUser(userId: string): string | null {
  if (unit(`${userId}:silent`) < AREA_SILENT) return null;
  return pick(AREA_DIST, () => unit(`${userId}:area`));
}
