/**
 * The predicate vocabulary lives in @clone/shared and is mirrored into the database
 * here, so there is exactly one definition. The Expo app, the extraction prompt and
 * the SQL constraint all read the same list.
 *
 * Idempotent: safe to run on every migrate.
 */
import type { PoolClient } from 'pg';
import { CORE_PREDICATES, OPEN_PREDICATES, SCREEN_PREDICATES, SITUATION_PREDICATES } from '@clone/shared';

export async function seedPredicates(c: PoolClient): Promise<number> {
  const rows = [
    ...CORE_PREDICATES.map((p) => ({
      name: p.name, tier: 'core', cardinality: p.cardinality,
      durability: p.durability, matchable: p.matchable,
    })),
    // Situation answers: closed and matchable like the core, but tapped only -- they
    // are not in CORE_PREDICATES, so the extraction prompt never offers them.
    ...SITUATION_PREDICATES.map((p) => ({
      name: p.name, tier: 'core', cardinality: p.cardinality,
      durability: p.durability, matchable: p.matchable,
    })),
    // Screen-only (the first name): typed by the person, never offered to the
    // extractor, and refused by `commit` from any other writer.
    ...SCREEN_PREDICATES.map((p) => ({
      name: p.name, tier: 'core', cardinality: p.cardinality,
      durability: p.durability, matchable: p.matchable,
    })),
    // The open tier is always multi-valued and always soft: free-text objects, vector
    // indexed, never queried by SQL. It is the escape hatch that keeps the closed
    // core vocabulary honest instead of forcing everything into a bad-fitting slot.
    ...OPEN_PREDICATES.map((name) => ({
      name, tier: 'open', cardinality: 'multi', durability: 'soft', matchable: false,
    })),
  ];

  for (const r of rows) {
    await c.query(
      `INSERT INTO predicates (name, tier, cardinality, durability, matchable)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (name) DO UPDATE
         SET tier = EXCLUDED.tier, cardinality = EXCLUDED.cardinality,
             durability = EXCLUDED.durability, matchable = EXCLUDED.matchable`,
      [r.name, r.tier, r.cardinality, r.durability, r.matchable],
    );
  }
  return rows.length;
}
