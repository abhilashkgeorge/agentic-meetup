/**
 * The stories screen: when an answer may be saved, and where the screen sits.
 *
 * WHY THE SCREEN EXISTS (the founder, 2026-09-24): agents that talk invent when they
 * have nothing real to say, so onboarding asks a few open questions and the agents may
 * only repeat what was written (server/src/matching/talk.ts, server/tests/stories.test.ts).
 *
 * The rule here: a Save is offered only for an answer the server can quote -- long
 * enough to be a sentence, not too long, and actually changed. And the screen is a step
 * of onboarding: the questions lead to it, and it leads on to the character.
 *
 * Negative controls, run by hand:
 *   - canSave without the `min` check            -> "long enough" fails
 *   - canSave allowing an unchanged answer       -> "changed" fails
 *   - the interview going straight to character  -> "onboarding" fails
 *   - contactNote always null                    -> "told, while typing" fails
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canSave, tooShort } from '../src/features/stories/stories-state';

describe('saving a story', () => {
  it('only when it is long enough to be quoted, and not too long', () => {
    expect(canSave('Sleeping', null, 12, 300)).toBe(false);
    expect(canSave('   Sleeping in, then dosa   ', null, 12, 300)).toBe(true);
    expect(canSave('x'.repeat(301), null, 12, 300)).toBe(false);
  });

  it('only when it changed', () => {
    expect(canSave('Sleeping in, then dosa', 'Sleeping in, then dosa', 12, 300)).toBe(false);
    expect(canSave('Sleeping in, then dosa ', 'Sleeping in, then dosa', 12, 300)).toBe(false);
    expect(canSave('Sleeping in, then idli', 'Sleeping in, then dosa', 12, 300)).toBe(true);
  });

  it('says "a little more" only for an answer started and too short', () => {
    expect(tooShort('', 12)).toBeNull();
    expect(tooShort('Dosa', 12)).not.toBeNull();
    expect(tooShort('Sleeping in, then dosa', 12)).toBeNull();
  });
});

describe('the stories in onboarding', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const src = (f: string) => strip(readFileSync(join(import.meta.dirname, '..', 'src', f), 'utf8'));

  it('come after the questions and lead on to the character', () => {
    expect(src('features/onboarding/interview-screen.tsx'))
      .toMatch(/router\.replace\(state\.ready \? '\/onboarding\/stories' : '\/onboarding\/essentials'\)/);
    expect(src('features/stories/stories-screen.tsx')).toMatch(/router\.replace\('\/onboarding\/character'\)/);
    expect(src('app/onboarding/_layout.tsx')).toMatch(/<Stack\.Screen name="stories" \/>/);
  });

  // The two-phone test, 2026-10-02: first-time setup ends its questions on the essentials,
  // never "ready", so the line above never ran -- the self-test went on to the character,
  // a new person never saw the stories, and two new people's agents had nothing to say.
  // The self-test's way out ("Done" and "Finish later" both) now leads to them.
  it('come after the self-test in first-time setup, the way every new person goes', () => {
    const test = src('features/onboarding/self-test-screen.tsx');
    const finish = test.slice(test.indexOf('const finish'), test.indexOf('}, []);', test.indexOf('const finish')));
    expect(finish).toContain("router.replace('/onboarding/stories')");
    expect(test).not.toContain("router.replace('/onboarding/character')");
    expect(test).toMatch(/label=\{ready\?\.ready \? 'Done' : 'Finish later'\}[\s\S]{0,120}onPress=\{\(\) => void finish\(\)\}/);
  });
});

describe('a story with a contact detail', () => {
  it('is told, while typing, that the agent will never repeat it', async () => {
    const { contactNote, CONTACT_NOTE } = await import('../src/features/stories/stories-state');
    expect(contactNote('Coffee, then text me on 98450 12345')).toBe(CONTACT_NOTE);
    expect(contactNote('I am @priya_pots everywhere')).toBe(CONTACT_NOTE);
    expect(contactNote('Coffee at Third Wave, then a walk in Cubbon Park')).toBeNull();
  });
});
