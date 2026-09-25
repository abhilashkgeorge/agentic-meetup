/**
 * "Finish setting it up" sends a person missing a core card to the interview.
 *
 * WHAT WAS WRONG. The five core cards (kids, one person or open, smoking, drinking,
 * food) joined the pool's requirements, so everybody who set up before them -- all six
 * real users, both of the founder's phones among them -- dropped out of the pool with
 * the cards' predicates on their missing list. The only way back is the "needs a few
 * more things" card on Matches (and its twins on Chats, the profile and the town), and
 * its button routed through setupRoute, which knew two places: consent, or the
 * essentials wizard. The wizard cannot ask a card. The button would have opened a
 * screen with nothing to answer and sent the person straight back, still out of the
 * pool, with nothing saying why.
 *
 * Negative control, run 2026-09-23: remove the CARD_PREDICATES branch from setupRoute
 * -> every "goes to the interview" case fails, returning '/onboarding/essentials'.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CARD_PREDICATES, missingLabel, setupRoute } from '../src/features/profile/fields';

describe('setupRoute', () => {
  it.each(['wants_children', 'monogamy_stance', 'smoking', 'drinking', 'diet'])(
    'goes to the interview when %s is missing',
    (predicate) => {
      expect(setupRoute([predicate])).toBe('/onboarding/interview');
    },
  );

  it('goes to the interview for a card even when an essential is missing too', () => {
    // The interview hands on to the essentials wizard when it is done, so the cards
    // first loses nothing; the wizard first would strand the cards.
    expect(setupRoute(['birth_date', 'smoking'])).toBe('/onboarding/interview');
    expect(setupRoute(['lives_in', 'area', 'max_distance_km', 'diet'])).toBe('/onboarding/interview');
  });

  it('still sends consent first, and essentials-only to the wizard', () => {
    expect(setupRoute(['consent', 'smoking'])).toBe('/consent');
    expect(setupRoute(['birth_date', 'lives_in'])).toBe('/onboarding/essentials');
    expect(setupRoute(['area'])).toBe('/onboarding/essentials');
    expect(setupRoute([])).toBe('/onboarding/essentials');
  });

  it('knows exactly the card predicates the server names', () => {
    // FROM THE SERVER'S OWN SOURCE, not a copy of it. The server puts a card's predicate
    // on `missing`; if it renamed or added a card and this list did not follow,
    // setupRoute would send that person to the essentials wizard, which has nothing
    // to ask -- the exact stranding this file exists to prevent -- and a hand-copied
    // list here would still pass. server/ is not a package the app imports, so the
    // file is read: CORE's ids, then each id's predicate from its card(...) line.
    const server = readFileSync(
      join(import.meta.dirname, '..', '..', 'server', 'src', 'onboarding', 'questions.ts'), 'utf8');
    const core = server.match(/export const CORE = \[([^\]]*)\]/);
    expect(core, 'questions.ts no longer declares CORE as a list').not.toBeNull();
    const ids = [...core![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
    const predicateOf = new Map(
      [...server.matchAll(/card\(\s*'([^']+)',\s*'([^']+)'/g)].map((m) => [m[1]!, m[2]!]));
    const predicates = ids.map((id) => predicateOf.get(id));
    expect(ids.length).toBeGreaterThan(0);
    expect(predicates, `a CORE id has no card(...) line: ${ids.join(', ')}`).not.toContain(undefined);

    expect([...CARD_PREDICATES].sort()).toEqual([...predicates].sort());
  });
});

describe('missingLabel for the cards', () => {
  it('prints words, not a column name', () => {
    for (const p of CARD_PREDICATES) {
      const words = missingLabel(p);
      expect(words, p).not.toBe(p.replace(/_/g, ' '));
      expect(words, p).not.toMatch(/_/);
    }
    expect(missingLabel('wants_children')).toBe('Whether you want kids');
    expect(missingLabel('monogamy_stance')).toBe('One person, or open');
  });
});

/** The code with its comments removed. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('the interview, reached from "Finish setting it up"', () => {
  // Behaviour on a navigator cannot be observed under vitest, so the source is read.
  // A finish=1 visitor must go on to the essentials wizard (which asks what else is
  // missing and then goes BACK), not into the first-time onboarding tail.
  const src = stripComments(readFileSync(
    join(import.meta.dirname, '..', 'src', 'features', 'onboarding', 'interview-screen.tsx'), 'utf8',
  ));

  it('reads finish=1 and hands on to the essentials wizard with it', () => {
    expect(src).toMatch(/const fromFinish = finish === '1'/);
    expect(src).toMatch(/if \(fromFinish\) \{\s*router\.replace\(\{ pathname: '\/onboarding\/essentials', params: \{ finish: '1' \} \}\)/);
  });

  it('does not walk a finish=1 visitor through the optional tail', () => {
    expect(src).toMatch(/fromFinish && \(q\.tier === 'optional' \|\| q\.tier === 'free'\)/);
  });
});
