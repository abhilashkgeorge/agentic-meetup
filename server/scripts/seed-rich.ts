/**
 * Eight invented people written by hand, with the texture a real person has.
 *
 * THE QUESTION THIS EXISTS TO ANSWER. Measured over 47 pairs, the synthetic pool
 * agreed 79.3% of the time. The founder -- the only account with a real, detailed
 * dossier -- scored about 12% across seven rounds, odds of 3.9e-5 at that base rate.
 * The concerns written about him all landed on the same thing, drawn from twenty
 * specific public facts.
 *
 * Two explanations fit, and they have opposite consequences:
 *
 *   the pool is bland    a 967-character generated dossier gives an assessor nothing
 *                        to object to, so it agrees; the product is fine and the
 *                        practice pool is the problem
 *   richness is punished specificity gives an assessor grounds to say no, so the
 *                        better the clone knows you the worse it matches you; the
 *                        product's central promise is inverted
 *
 * You cannot separate them with three real profiles. These eight are the cheap
 * substitute: invented, but written the way a person actually reads -- concrete
 * details, contradictions, things that are genuinely awkward, and the sort of
 * specific commitment ("Tuesdays are not negotiable") that an assessor can catch on.
 *
 * WRITTEN, NOT GENERATED, ON PURPOSE. A generator that produced these would be the
 * fix for the bland pool rather than the test of it, and it would carry whatever
 * uniformity the generator has. Eight is enough for 28 possible pairs.
 *
 *   tsx scripts/seed-rich.ts
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { env } from '../src/env.js';

export const RICH_TENANT = 'rich-pool';

interface Rich {
  name: string;
  gender: 'man' | 'woman';
  seeking: ('man' | 'woman')[];
  age: number;
  intent: string[];
  tags: string[];
  traits: Record<string, string>;
  dossier: string;
  /** Said in their own words, with a month. No two people share a sentence. */
  quotes: { predicate: string; text: string; when: string }[];
}

/** Bangalore, so distance never filters anybody out and the test is about the people. */
const LAT = 12.97;
const LON = 77.59;

const PEOPLE: Rich[] = [
  {
    name: 'Meera', gender: 'woman', seeking: ['man'], age: 31,
    intent: ['long_term'],
    tags: ['interest:pottery', 'interest:trail running', 'works_in:public health',
      'interest:tamil cinema'],
    traits: { diet: 'vegetarian', exercise_habit: 'often', drinking: 'rarely',
      relationship_intent: 'long_term', smoking: 'never' },
    dossier: `Epidemiologist at a state public-health unit; spent 2024 on a tuberculosis
contact-tracing programme in north Karnataka and came back changed by it. Runs trail
routes outside the city most Sunday mornings, badly and happily. Took up pottery two
years ago and is still at the stage of producing objects nobody wants. Vegetarian since
childhood and entirely uninterested in discussing it. Watches Tamil cinema with the
seriousness other people bring to football, and will argue about Mani Ratnam.
Recently ended a seven-year relationship and is candid that she is not fully over it.
Says she wants something long-term and also that she has said that before and been
wrong.`,
    quotes: [
      { predicate: 'relationship_intent', text: 'I want the long thing, and I am aware I said that last time and was wrong about it.', when: '2026-02-01' },
      { predicate: 'interest', text: 'I run badly and on purpose. It is the only two hours nobody can reach me.', when: '2025-11-01' },
      { predicate: 'dealbreaker', text: 'If someone makes a face about my food I already know how the rest of it goes.', when: '2025-09-01' },
    ],
  },
  {
    name: 'Arjun', gender: 'man', seeking: ['woman'], age: 34,
    intent: ['long_term'],
    tags: ['interest:carnatic music', 'works_in:architecture', 'interest:cycling',
      'interest:restoration'],
    traits: { diet: 'omnivore', exercise_habit: 'often', drinking: 'sometimes',
      relationship_intent: 'long_term', smoking: 'never' },
    dossier: `Architect, eleven years in, most of it on conservation work -- currently two
years into restoring a 1930s bungalow in Malleswaram whose owners change their minds
monthly. Learned Carnatic vocal until nineteen, stopped, restarted at thirty-one and
is embarrassed about how much it matters to him. Cycles to sites rather than drives,
which makes him late and unapologetic about it. Cooks elaborately and rarely. Lives
with a brother who is between things. Openly says his work eats weekends and that two
previous relationships ended over exactly that, and he has not obviously changed
anything about it.`,
    quotes: [
      { predicate: 'did', text: 'I have been restoring one house for two years. The owners change their minds every month and I let them.', when: '2026-01-01' },
      { predicate: 'believes', text: 'Two people have left me over how much I work. I keep saying I will fix it.', when: '2025-12-01' },
      { predicate: 'interest', text: 'I started singing again at thirty-one and I am embarrassed by how much it matters.', when: '2025-08-01' },
    ],
  },
  {
    name: 'Nikhil', gender: 'man', seeking: ['woman'], age: 29,
    intent: ['long_term', 'marriage'],
    tags: ['works_in:machine learning', 'interest:bouldering', 'interest:bread',
      'interest:board games'],
    traits: { diet: 'omnivore', exercise_habit: 'daily', drinking: 'never',
      relationship_intent: 'long_term', smoking: 'never' },
    dossier: `Machine-learning engineer at a mid-size company, deliberately not at a startup
after one that took two years and paid in equity that evaporated. Boulders four
evenings a week and organises his life around it to a degree he knows is a lot. Bakes
sourdough with the same intensity. Does not drink, has never made a thing of it, and
finds that it quietly filters people anyway. Wants to be married within a few years
and says so early because he is tired of finding out at month eight. Close to his
parents, who live twenty minutes away and visit without warning.`,
    quotes: [
      { predicate: 'relationship_intent', text: 'I want to be married in a few years. I say it early now because month eight is an expensive place to find out.', when: '2026-03-01' },
      { predicate: 'exercise_habit', text: 'I climb four evenings a week and I arrange everything else around it, which I know is a lot to ask.', when: '2025-10-01' },
      { predicate: 'did', text: 'I gave a startup two years and got paid in equity that turned out to be nothing.', when: '2025-06-01' },
    ],
  },
  {
    name: 'Divya', gender: 'woman', seeking: ['man'], age: 27,
    intent: ['long_term'],
    tags: ['works_in:documentary film', 'interest:archives', 'interest:swimming',
      'interest:carnatic music'],
    traits: { diet: 'no_beef', exercise_habit: 'sometimes', drinking: 'sometimes',
      relationship_intent: 'long_term', smoking: 'sometimes' },
    dossier: `Documentary researcher; two years inside state archives on a film about the
1970s labour movement that may never be finished and that she cannot stop working on.
Swims at six in the morning because the pool is empty. Smokes when she is writing,
which is often, and is defensive about it. Grew up in a Carnatic household and has
complicated feelings about it. Income is irregular and she is frank that she has
turned down steadier work twice. Says the thing she needs most from somebody is that
they not treat her project as a phase.`,
    quotes: [
      { predicate: 'did', text: 'I have been in the archives for two years on a film that may never get finished.', when: '2026-01-01' },
      { predicate: 'dealbreaker', text: 'If someone treats what I am making as a phase I am going to be done quite quickly.', when: '2025-12-01' },
      { predicate: 'smoking', text: 'I smoke when I write, which is most days, and I get defensive when people mention it.', when: '2025-07-01' },
    ],
  },
  {
    name: 'Kabir', gender: 'man', seeking: ['woman'], age: 33,
    intent: ['long_term'],
    tags: ['works_in:emergency medicine', 'interest:motorcycles', 'interest:urdu poetry',
      'interest:cooking'],
    traits: { diet: 'omnivore', exercise_habit: 'rarely', drinking: 'sometimes',
      relationship_intent: 'long_term', smoking: 'never' },
    dossier: `Emergency physician on rotating nights, which means he is unreliable in the
specific way shift work makes people unreliable and he does not pretend otherwise.
Rides a motorcycle he has owned since college and repairs himself, poorly. Reads Urdu
poetry and will recite it after two drinks. Cooks for ten people at a time or not at
all. Divorced at thirty, amicably, and talks about it without drama. Says plainly that
he cannot promise to be awake on a given evening and that every relationship since the
divorce has run aground on that.`,
    quotes: [
      { predicate: 'did', text: 'I work rotating nights. I cannot promise you I will be awake on a Thursday and I have stopped pretending I can.', when: '2026-02-01' },
      { predicate: 'relationship_status', text: 'I was married and it ended at thirty. It was not dramatic and I do not mind talking about it.', when: '2025-11-01' },
      { predicate: 'interest', text: 'I have had the same motorcycle since college and I repair it badly rather than pay someone.', when: '2025-05-01' },
    ],
  },
  {
    name: 'Ananya', gender: 'woman', seeking: ['man'], age: 30,
    intent: ['long_term'],
    tags: ['works_in:labour law', 'interest:birdwatching', 'interest:cricket',
      'interest:translation'],
    traits: { diet: 'omnivore', exercise_habit: 'sometimes', drinking: 'rarely',
      relationship_intent: 'long_term', smoking: 'never' },
    dossier: `Labour lawyer, mostly on the side that does not pay well, and describes the
work as slow and mostly losing. Birdwatches, seriously enough to keep lists and take
holidays around it. Follows domestic cricket rather than internationals, which she
knows is an odd hill. Translating a Kannada short-story collection into English in the
evenings and is two years behind. Was engaged at twenty-six and called it off three
weeks before, which she brings up early rather than late. Lives alone and is protective
of it.`,
    quotes: [
      { predicate: 'did', text: 'I called off an engagement three weeks before the date. I say it early because saying it late is worse.', when: '2026-01-01' },
      { predicate: 'works_in', text: 'I do labour law on the side that loses, slowly, most of the time.', when: '2025-10-01' },
      { predicate: 'dealbreaker', text: 'I live alone and I am protective about it. Somebody who wants to move in fast will not enjoy me.', when: '2025-09-01' },
    ],
  },
  {
    name: 'Rohan', gender: 'man', seeking: ['woman'], age: 28,
    intent: ['long_term', 'companionship'],
    tags: ['works_in:secondary teaching', 'interest:theatre', 'interest:long walks',
      'interest:history'],
    traits: { diet: 'vegetarian', exercise_habit: 'sometimes', drinking: 'never',
      relationship_intent: 'long_term', smoking: 'never' },
    dossier: `Teaches history to sixteen-year-olds and is one of the few people who says the
job is good. Acts with an amateur theatre group that rehearses four nights a week for
two months of the year and vanishes for the rest. Walks ten kilometres on Sundays,
alone, and says it is the only time he thinks properly. Vegetarian, does not drink,
and is careful to say neither is a moral position. Salary is modest and fixed and he
is unbothered; says he has watched friends earn four times as much and be worse off.
Has never lived away from Bangalore and is not curious about it, which he knows some
people find small.`,
    quotes: [
      { predicate: 'works_in', text: 'I teach history to sixteen-year-olds and I actually like it, which people find suspicious.', when: '2026-02-01' },
      { predicate: 'believes', text: 'I have watched friends earn four times what I do and end up worse off. I stopped envying it.', when: '2025-12-01' },
      { predicate: 'did', text: 'I have never lived anywhere but here and I am not especially curious about it.', when: '2025-08-01' },
    ],
  },
  {
    name: 'Sneha', gender: 'woman', seeking: ['man'], age: 32,
    intent: ['long_term', 'marriage'],
    tags: ['works_in:supply chain', 'interest:scuba', 'interest:carpentry',
      'interest:podcasts'],
    traits: { diet: 'omnivore', exercise_habit: 'often', drinking: 'sometimes',
      relationship_intent: 'marriage', smoking: 'never' },
    dossier: `Runs regional logistics for a manufacturer -- an unglamorous job she is
genuinely good at and slightly defensive about at parties. Dives twice a year, badly
enough that she is still on her open-water certification after four years. Builds
furniture in a rented workshop on weekends and has made one chair she is willing to
sit on. Wants children and says so at the start, having spent two years with somebody
who kept saying "later". Travels for work about a week a month. Is direct to a degree
that she has been told, more than once, reads as blunt.`,
    quotes: [
      { predicate: 'wants_children', text: 'I want children, and I spent two years with someone who kept saying later, so I lead with it now.', when: '2026-03-01' },
      { predicate: 'works_in', text: 'I do logistics. It is unglamorous and I am good at it and I get prickly when people smile about it.', when: '2025-11-01' },
      { predicate: 'did', text: 'I have made exactly one chair I am willing to sit on.', when: '2025-06-01' },
    ],
  },
];

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });

// `tenants.name` carries no unique constraint, so ON CONFLICT DO NOTHING silently
// does nothing to stop a second one: the first run of this script produced two
// rich-pool tenants and sixteen profiles. Look before inserting.
const found = await owner.query<{ id: string }>(
  'SELECT id FROM tenants WHERE name = $1 ORDER BY id LIMIT 1', [RICH_TENANT]);
const tenantId = found.rows[0]?.id
  ?? (await owner.query<{ id: string }>(
       'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [RICH_TENANT])).rows[0]!.id;

let n = 0;
for (const p of PEOPLE) {
  const existing = await owner.query<{ user_id: string }>(
    'SELECT user_id FROM match_profile WHERE tenant_id = $1 AND display_name = $2',
    [tenantId, p.name]);
  const userId = existing.rows[0]?.user_id ?? randomUUID();

  await owner.query(
    `INSERT INTO app_users (id, tenant_id, email, tier)
     VALUES ($1,$2,$3,'trial') ON CONFLICT (id) DO NOTHING`,
    [userId, tenantId, `${p.name.toLowerCase()}@rich.invalid`]);

  await owner.query(
    `INSERT INTO match_profile (
       user_id, tenant_id, age, gender, seeking_gender, age_min, age_max,
       lat, lon, max_distance_km, intent, attribute_tags, traits, display_name,
       synthetic_dossier, synthetic_quotes,
       in_pool, is_synthetic, sees_synthetic, last_active_at, rebuilt_at)
     VALUES ($1,$2,$3,$4,$5,22,45,$6,$7,50,$8,$9,$10,$11,$12,$13, true, true, false, now(), now())
     ON CONFLICT (user_id) DO UPDATE SET
       synthetic_dossier = EXCLUDED.synthetic_dossier,
       synthetic_quotes  = EXCLUDED.synthetic_quotes,
       attribute_tags    = EXCLUDED.attribute_tags,
       traits            = EXCLUDED.traits,
       rebuilt_at        = now()`,
    [userId, tenantId, p.age, p.gender, p.seeking, LAT, LON, p.intent,
     p.tags, JSON.stringify(p.traits), p.name,
     p.dossier.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim(),
     JSON.stringify(p.quotes)],
  );
  n++;
}

// The property that makes this a control rather than more of the same.
const dup = await owner.query<{ n: string }>(
  `SELECT count(*) AS n FROM (
     SELECT q->>'text' AS t FROM match_profile, jsonb_array_elements(synthetic_quotes) q
      WHERE tenant_id = $1 GROUP BY 1 HAVING count(*) > 1) s`, [tenantId]);

console.log(`${n} rich profiles in tenant "${RICH_TENANT}"`);
console.log(
  `sentences shared by more than one of them: ${dup.rows[0]?.n ?? 0}`
  + ' (one sentence in the template pool is shared by 2,249 people)',
);
await owner.end();
