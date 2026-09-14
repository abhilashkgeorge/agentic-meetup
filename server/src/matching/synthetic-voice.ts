/**
 * Giving the invented pool something to say.
 *
 * WHY THIS EXISTS. Synthetic people never touch `facts` -- migration 0010 forbids an
 * untrusted-origin fact from ever being active, and weakening that to accommodate
 * invented people would delete the guarantee that protects the real ones. But the
 * rendezvous reads its dossier from `facts`, so the first real round sent one agent
 * into five conversations carrying NOTHING, and it said yes twice anyway. Two agents
 * on the same base model will agree pleasantly about nobody at all.
 *
 * NO MODEL IS CALLED HERE. The sentences are assembled from the traits the sampler
 * already drew, by template. Three reasons, in order of importance:
 *
 *   1. Asking a model to write five thousand dating profiles produces five thousand
 *      variations of one person -- the exact mode collapse the sampler exists to
 *      avoid. Diversity is a property of the distribution, not of the prose.
 *   2. It is free and instant, and the pool is regenerated whenever the marginals
 *      change.
 *   3. Deterministic from the seed, so a change in match rates is attributable to the
 *      change you made rather than to today's sampling of the writer.
 *
 * These sentences are NOT evidence about anybody and must never be shown as though
 * they were. They live in match_profile, behind a CHECK constraint that a real
 * person's row cannot carry them.
 */

/** Roughly when an invented person "said" a thing. Spread over two years. */
function when(r: () => number): string {
  const monthsAgo = Math.floor(r() * 24);
  const d = new Date(Date.UTC(2026, 8, 1));
  d.setUTCMonth(d.getUTCMonth() - monthsAgo);
  return d.toISOString().slice(0, 10);
}

const readable = (v: unknown): string => String(v).replace(/[-_]/g, ' ');

const INTENT_SAYS: Record<string, string> = {
  long_term: 'I am looking for something that actually goes somewhere.',
  casual: 'I am not in a hurry to make anything serious out of this.',
  marriage: 'I would like to be married in the next few years.',
  undecided: 'I am honestly not sure what I am looking for yet.',
  friendship: 'Mostly I want people to do things with.',
};

const SLEEP_SAYS: Record<string, string> = {
  early: 'I am up at six whether I like it or not.',
  late: 'Nothing good happens to me before eleven in the morning.',
  irregular: 'My sleep is a mess and I have stopped pretending otherwise.',
};

const SPEND_SAYS: Record<string, string> = {
  saver: 'I would rather have the money sitting there than the thing.',
  spender: 'I am bad with money in the specific way where I buy the good version.',
  balanced: 'I save for the big things and do not think about the small ones.',
};

/**
 * An ordinary week, which is what the prober actually asks about.
 *
 * Four real rendezvous returned "we still don't know any concrete details about her
 * beyond broad hobbies" -- a verdict about the CONVERSATION being too thin, not about
 * the person. A list of tags cannot answer "what did you do last weekend", so the
 * invented people are given one, assembled from the tags they already have.
 */
const WEEK: ((x: { interests: string[]; media: string[]; work: string; city: string | null }) => string | null)[] = [
  (x) => x.interests[0]
    ? `Most weekends I end up doing ${x.interests[0]} — it is the one thing I protect time for.`
    : null,
  (x) => x.work !== 'something they have not said'
    ? `Work is ${x.work}, and it takes about as much of me as I let it. Some weeks that is too much.`
    : null,
  (x) => x.interests[1] && x.interests[2]
    ? `If I have a free Saturday it is usually ${x.interests[1]} in the morning and ${x.interests[2]} later on.`
    : null,
  (x) => x.media[0]
    ? `I am the sort of person who will finish ${x.media[0]} at two in the morning and regret it at seven.`
    : null,
  (x) => x.city
    ? `I have been in ${x.city} long enough to have opinions about it, most of them fond.`
    : null,
  (x) => x.interests[3]
    ? `I picked up ${x.interests[3]} recently and I am still visibly bad at it, which I quite enjoy.`
    : null,
  () => 'The thing that annoys me most is people who cancel twice. Once is life; twice is an answer.',
  () => 'I would rather do something than sit across a table talking about ourselves for two hours.',
];

export interface SyntheticVoice {
  dossier: string;
  quotes: { predicate: string; text: string; when: string }[];
}

/**
 * What this invented person's agent may say, and the handful of sentences a brief can
 * quote. Takes the same seeded generator as the profile, so it is reproducible.
 */
export function voiceFor(
  p: {
    displayName: string; age: number; gender: string;
    intent: string[]; attributeTags: string[]; traits: Record<string, unknown>;
    city?: string | null;
  },
  r: () => number,
): SyntheticVoice {
  const interests = p.attributeTags
    .filter((t) => t.startsWith('interest:'))
    .map((t) => readable(t.slice('interest:'.length)));
  const media = p.attributeTags
    .filter((t) => t.startsWith('media_taste:'))
    .map((t) => readable(t.slice('media_taste:'.length)));
  const worksIn = readable(p.traits.works_in ?? 'something they have not said');

  const quotes: { predicate: string; text: string; when: string }[] = [];
  const add = (predicate: string, text: string) =>
    quotes.push({ predicate, text, when: when(r) });

  if (interests.length) {
    add('interest', `I spend most of my free time on ${interests[0]}, more than is probably reasonable.`);
  }
  if (interests.length > 1) {
    add('interest', `I got into ${interests[1]} a while back and it stuck.`);
  }
  if (p.traits.works_in) {
    add('works_in', `I work in ${worksIn}. Some weeks that is the whole of my life.`);
  }
  if (media.length) {
    add('media_taste', `I will happily lose an evening to ${media[0]}.`);
  }
  const intent = p.intent[0];
  if (intent && INTENT_SAYS[intent]) add('relationship_intent', INTENT_SAYS[intent]!);
  if (typeof p.traits.sleep_pattern === 'string' && SLEEP_SAYS[p.traits.sleep_pattern]) {
    add('sleep_pattern', SLEEP_SAYS[p.traits.sleep_pattern]!);
  }
  if (typeof p.traits.spending_style === 'string' && SPEND_SAYS[p.traits.spending_style]) {
    add('spending_style', SPEND_SAYS[p.traits.spending_style]!);
  }
  if (p.traits.diet && p.traits.diet !== 'omnivore') {
    add('diet', `I am ${readable(p.traits.diet)}, and I am not difficult about other people's plates.`);
  }
  if (p.traits.exercise_habit) {
    add('exercise_habit', `I train ${readable(p.traits.exercise_habit)} — it is the thing that keeps me level.`);
  }

  // What an ordinary week looks like. Half of them, chosen by the same seeded
  // generator, so two invented people do not answer the same question identically.
  const context = {
    interests, media, work: worksIn,
    city: p.city ? readable(p.city) : null,
  };
  for (const line of WEEK) {
    if (r() < 0.55) continue;
    const said = line(context);
    if (said) add('topic', said);
  }

  // The dossier the agent carries. Same shape as a real one: short lines of fact, no
  // prose about how wonderful they are.
  const lines = [
    `- age: ${p.age}`,
    `- gender: ${p.gender}`,
    p.city ? `- lives in: ${readable(p.city)}` : null,
    p.traits.works_in ? `- works in: ${worksIn}` : null,
    interests.length ? `- into: ${interests.join(', ')}` : null,
    media.length ? `- watches and reads: ${media.join(', ')}` : null,
    intent ? `- looking for: ${readable(intent)}` : null,
    p.traits.wants_children ? `- children: ${readable(p.traits.wants_children)}` : null,
    p.traits.diet ? `- diet: ${readable(p.traits.diet)}` : null,
    p.traits.sleep_pattern ? `- sleep: ${readable(p.traits.sleep_pattern)}` : null,
    p.traits.exercise_habit ? `- exercise: ${readable(p.traits.exercise_habit)}` : null,
    p.traits.education_level ? `- education: ${readable(p.traits.education_level)}` : null,
    p.traits.transport ? `- gets around by: ${readable(p.traits.transport)}` : null,
  ].filter(Boolean);

  const dossier = [
    `${p.displayName} is ${p.age}.`,
    lines.join('\n'),
    quotes.length ? `\nThings they have said:\n${quotes.map((q) => `- "${q.text}"`).join('\n')}` : '',
  ].filter(Boolean).join('\n');

  return { dossier, quotes };
}
