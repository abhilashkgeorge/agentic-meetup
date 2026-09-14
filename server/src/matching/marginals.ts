/**
 * The distributions synthetic people are sampled from.
 *
 * WRITTEN BY HAND, ON PURPOSE, AND REVIEWABLE IN A DIFF.
 *
 * The tempting alternative is asking a model for "1,000 diverse dating profiles",
 * and it fails in a specific way: you get a thousand variations of one person —
 * everybody hikes, everybody loves trying new restaurants, everybody is
 * "adventurous but also loves a quiet night in". Mode collapse is the single largest
 * risk in synthetic data and no prompt fixes it, because diversity is a property of
 * the sampler, not of the text.
 *
 * So the STRUCTURE is sampled from numbers somebody can argue with, and a model is
 * only ever allowed to write the prose on top of a tuple that is already decided.
 *
 * These numbers are plausible, not measured. They are here to exercise the matcher,
 * and the moment real users exist they should be replaced by what those users
 * actually are. Nothing downstream reads them as truth about the world.
 */

/** A weighted choice. Weights are relative; they need not sum to anything. */
export type Dist<T extends string> = readonly (readonly [T, number])[];

export const pick = <T extends string>(d: Dist<T>, rnd: () => number): T => {
  const total = d.reduce((a, [, w]) => a + w, 0);
  let r = rnd() * total;
  for (const [value, w] of d) {
    r -= w;
    if (r <= 0) return value;
  }
  return d[d.length - 1]![0];
};

export const GENDER: Dist<'woman' | 'man' | 'nonbinary'> = [
  ['woman', 48], ['man', 49], ['nonbinary', 3],
];

/** Skewed young, the way dating pools actually are. */
export const AGE_BANDS: Dist<'21-25' | '26-30' | '31-35' | '36-42' | '43-55'> = [
  ['21-25', 18], ['26-30', 32], ['31-35', 24], ['36-42', 16], ['43-55', 10],
];

export const INTENT: Dist<'long_term' | 'marriage' | 'companionship' | 'casual' | 'undecided'> = [
  ['long_term', 40], ['marriage', 18], ['companionship', 12], ['casual', 18], ['undecided', 12],
];

export const MONOGAMY: Dist<'monogamous' | 'non_monogamous' | 'open_to_either'> = [
  ['monogamous', 78], ['non_monogamous', 8], ['open_to_either', 14],
];

export const WANTS_CHILDREN: Dist<'yes' | 'no' | 'maybe' | 'have_and_done'> = [
  ['yes', 38], ['no', 22], ['maybe', 30], ['have_and_done', 10],
];

export const DIET: Dist<'omnivore' | 'no_beef' | 'no_pork' | 'pescatarian' | 'vegetarian' | 'vegan'> = [
  ['omnivore', 46], ['no_beef', 18], ['no_pork', 6], ['pescatarian', 8],
  ['vegetarian', 19], ['vegan', 3],
];

export const FREQ: Dist<'never' | 'rarely' | 'sometimes' | 'often' | 'daily'> = [
  ['never', 22], ['rarely', 26], ['sometimes', 28], ['often', 18], ['daily', 6],
];

export const IMPORTANCE: Dist<'none' | 'low' | 'medium' | 'high'> = [
  ['none', 30], ['low', 26], ['medium', 26], ['high', 18],
];

export const EDUCATION: Dist<'school' | 'some_college' | 'bachelors' | 'masters' | 'doctorate'> = [
  ['school', 8], ['some_college', 14], ['bachelors', 46], ['masters', 27], ['doctorate', 5],
];

export const WORKS_IN: Dist<string> = [
  ['software', 16], ['ai', 7], ['design', 8], ['medicine', 7], ['teaching', 8],
  ['finance', 9], ['law', 4], ['media', 6], ['hardware', 4], ['research', 5],
  ['sales', 8], ['hospitality', 6], ['logistics', 5], ['civil-service', 4],
  ['art', 3],
];

/** Long-tail on purpose: a pool where everybody hikes is a pool that tests nothing. */
export const INTERESTS: readonly string[] = [
  'hiking', 'cooking', 'running', 'cycling', 'swimming', 'climbing', 'yoga', 'lifting',
  'football', 'cricket', 'badminton', 'chess', 'board-games', 'video-games', 'anime',
  'one-piece', 'k-drama', 'foreign-film', 'documentaries', 'stand-up', 'theatre',
  'live-music', 'techno', 'carnatic', 'jazz', 'vinyl', 'photography', 'painting',
  'pottery', 'knitting', 'gardening', 'birdwatching', 'astronomy', 'scuba',
  'motorbikes', 'classic-cars', 'woodworking', 'electronics', 'home-lab', '3d-printing',
  'open-source', 'startups', 'investing', 'history', 'philosophy', 'poetry',
  'sci-fi', 'true-crime', 'baking', 'coffee', 'whisky', 'street-food', 'travel',
  'backpacking', 'languages', 'volunteering', 'dogs', 'cats', 'aquariums', 'horses',
];

export const MEDIA: readonly string[] = [
  'foreign-film', 'bollywood', 'regional-cinema', 'prestige-tv', 'anime', 'reality-tv',
  'documentaries', 'podcasts', 'audiobooks', 'literary-fiction', 'comics',
];

export const TRANSPORT: Dist<string> = [
  ['car', 34], ['metro', 22], ['motorbike', 16], ['cycle', 8], ['electric-cycle', 4],
  ['walking', 10], ['auto', 6],
];

export const SPENDING: Dist<string> = [
  ['value-driven', 40], ['comfortable', 34], ['saver', 16], ['brand-conscious', 10],
];

export const SLEEP: Dist<string> = [['early', 34], ['normal', 44], ['night-owl', 22]];

export const BODY: Dist<string> = [
  ['slim', 30], ['average', 38], ['athletic', 20], ['curvy', 9], ['large', 3],
];

/**
 * Where synthetic people live. Weighted toward the first real user's city, because a
 * pool spread evenly over the planet tests the distance filter and nothing else.
 */
export const CITIES: Dist<string> = [
  ['Bangalore', 46], ['Mumbai', 10], ['Delhi', 9], ['Hyderabad', 7], ['Pune', 6],
  ['Chennai', 5], ['Kochi', 3], ['Goa', 2], ['London', 4], ['Singapore', 2],
  ['Dubai', 2], ['New York', 2], ['Toronto', 1], ['Sydney', 1],
];

export const NATIONALITY: Dist<string> = [
  ['india', 74], ['usa', 6], ['uk', 5], ['canada', 3], ['australia', 3],
  ['singapore', 2], ['germany', 2], ['france', 1], ['japan', 1], ['brazil', 1],
  ['nigeria', 1], ['philippines', 1],
];

/**
 * Conditional tilts, so the joint distribution is not independent-marginal mush.
 *
 * Without these, a 24-year-old is as likely to want marriage as a 40-year-old and
 * religion and politics are uncorrelated — which produces people who do not exist and
 * makes every matching result meaningless.
 */
export function tilt(
  age: number,
  religionImportance: string,
): { intentBias: number; childrenBias: number; politicsBias: string } {
  return {
    // Older skews toward something settled.
    intentBias: age >= 30 ? 1.6 : age <= 24 ? 0.6 : 1,
    childrenBias: age >= 32 ? 1.4 : age <= 25 ? 0.7 : 1,
    // Somebody for whom religion matters a great deal usually has politics that
    // matter too. The direction is not modelled; only the intensity.
    politicsBias: religionImportance === 'high' ? 'high' : religionImportance,
  };
}
