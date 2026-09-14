/**
 * Give the existing 5,000 invented people something to say.
 *
 * They were seeded before the dossier columns existed. Regenerating the pool would
 * change every id and invalidate the rendezvous already run against it, so this walks
 * the rows and fills in what the sampler would have written.
 *
 * No model is called. The sentences come from the traits already in the row.
 */
import { Pool } from 'pg';
import { env } from '../src/env.js';
import { voiceFor } from '../src/matching/synthetic-voice.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });

/** Seeded per person from their id, so a rerun writes exactly the same sentences. */
function rngFor(id: string): () => number {
  let s = 0;
  for (const ch of id) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const { rows } = await owner.query<{
  user_id: string; display_name: string | null; age: number | null; gender: string | null;
  intent: string[]; attribute_tags: string[]; traits: Record<string, unknown>;
}>(
  `SELECT user_id, display_name, age, gender, intent, attribute_tags, traits
     FROM match_profile
    WHERE is_synthetic AND synthetic_dossier IS NULL`,
);

console.log(`${rows.length} to fill`);
let n = 0;
for (const p of rows) {
  const voice = voiceFor(
    {
      displayName: p.display_name ?? 'Someone',
      age: p.age ?? 30,
      gender: p.gender ?? 'unstated',
      intent: p.intent ?? [],
      attributeTags: p.attribute_tags ?? [],
      traits: p.traits ?? {},
      city: null,
    },
    rngFor(p.user_id),
  );
  await owner.query(
    'UPDATE match_profile SET synthetic_dossier = $2, synthetic_quotes = $3 WHERE user_id = $1',
    [p.user_id, voice.dossier, JSON.stringify(voice.quotes)],
  );
  if (++n % 500 === 0) console.log(`${n}/${rows.length}`);
}
console.log(`filled ${n}`);
await owner.end();
