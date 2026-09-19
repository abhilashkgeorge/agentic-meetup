/**
 * The after-date questions, built only from what this person was shown.
 *
 * The input is the reveal -- the same object GET /v1/matches/:id serialised for them
 * (first name, age, city, a few tags) plus whether they could see photos. Nothing
 * else exists here: no facts, no traits, no dossier. If the reveal did not say it,
 * this cannot ask about it, and tests/checkin.test.ts plants a never-public fact on
 * the other person to prove the point.
 *
 * Yes / no / not sure, never a rating and never free text about somebody else. The
 * identity questions (photos, age, name, city) are what "confirmed by N people"
 * counts; the tag questions are conversation, and count for nothing.
 */
export interface Shown {
  name: string;
  age: number | null;
  livesIn: string | null;
  /** Raw `prefix:value` tags as the reveal selected them, before it flattened the words. */
  tags: string[];
  photosVisible: boolean;
}

export interface CheckinQuestion {
  key: string;
  text: string;
  /** Counts towards "confirmed by N people" -- and a 'no' here is what the desk looks at. */
  identity: boolean;
}

export const ANSWERS = ['yes', 'no', 'unsure'] as const;
export type Answer = (typeof ANSWERS)[number];
export const IDENTITY_KEYS = ['photos', 'age', 'name', 'city'] as const;
export const WHY_NOT = ['plans_fell_through', 'stopped_replying', 'changed_my_mind', 'other'] as const;
const MAX_QUESTIONS = 6;
const MAX_TAGS = 2;

export function checkinQuestions(s: Shown): CheckinQuestion[] {
  const out: CheckinQuestion[] = [];
  if (s.photosVisible) out.push({ key: 'photos', text: 'Did they look like their photos?', identity: true });
  if (s.age) out.push({ key: 'age', text: `Did they seem about ${s.age}?`, identity: true });
  if (s.name && s.name !== 'Someone') out.push({ key: 'name', text: `Did they go by ${s.name}?`, identity: true });
  if (s.livesIn) out.push({ key: 'city', text: `Do they live around ${s.livesIn}?`, identity: true });
  let tags = 0;
  for (const t of s.tags) {
    if (out.length >= MAX_QUESTIONS || tags >= MAX_TAGS) break;
    const [prefix, raw] = t.split(':');
    const word = raw?.replace(/[-_]/g, ' ');
    if (!word) continue;
    if (prefix === 'interest') out.push({ key: `tag:${word}`, text: `Did ${word} come up?`, identity: false });
    else if (prefix === 'works_in') out.push({ key: `tag:${word}`, text: `Do they work in ${word}?`, identity: false });
    else continue;
    tags++;
  }
  return out;
}
