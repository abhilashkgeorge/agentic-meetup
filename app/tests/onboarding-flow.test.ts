/**
 * Setup as one flow (the founder and the Pixel, 2026-10-02).
 *
 * 1. The end of the cards went to "A few things missing" -- birth year, where you live --
 *    and a "Finish the basics" button, for every new person, who had skipped nothing:
 *    those questions simply come next. Now the interview goes straight on to them
 *    (questions-end.ts), and keeps a screen only for "That's enough to start".
 * 2. "Where are you now?" with its keyboard up cut its step dots off the top and its note
 *    in half above Next; the general note now gives way to the keyboard.
 * 3. One screen served every step and kept the last one's scroll, so the map step opened
 *    with its dots under the header; each step is now its own screen, at the top.
 * 4. "Could not work out where you are. Type your city instead." stayed up, red, over a
 *    city being typed; typing clears it. And it was two lines where one fits above Next
 *    with the keyboard up, so its end was cut off; it is one line now.
 *
 * WHAT IS PINNED. Where the end of the questions goes (plain functions), and the shape of
 * the screens: a navigator, a keyboard and a scroll position cannot be watched under
 * vitest, so the source is read, comments stripped.
 *
 * Negative controls, run by hand and recorded in the commit: interview-screen.tsx as it
 * was -> "no screen calls anything missing" fails; essentials-screen.tsx as it was ->
 * "each step" and "in one line" fail.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { questionsOver, straightOn } from '../src/features/onboarding/questions-end';

const src = (...p: string[]) => stripComments(readFileSync(join(import.meta.dirname, '..', 'src', ...p), 'utf8'));
const card = (tier: string) => ({ tier }) as Parameters<typeof questionsOver>[0];

describe('the end of the questions', () => {
  it('goes straight on to the essentials when they are still to come', () => {
    expect(straightOn(true, false, false)).toBe('/onboarding/essentials');
    expect(straightOn(true, false, true)).toBe('/onboarding/essentials?finish=1');
  });

  it('stops for "That\'s enough to start", and never while questions remain', () => {
    expect(straightOn(true, true, false)).toBeNull();
    expect(straightOn(false, false, false)).toBeNull();
  });

  it('comes when nothing is left, when they stop, or for a returning visitor at the optional tail', () => {
    expect(questionsOver(null, false, false)).toBe(true);
    expect(questionsOver(card('optional'), true, false)).toBe(true);
    expect(questionsOver(card('optional'), false, true)).toBe(true);
    expect(questionsOver(card('core'), false, true)).toBe(false);
    expect(questionsOver(card('optional'), false, false)).toBe(false);
  });

  it('no screen calls anything missing: the interview hands on instead', () => {
    const interview = src('features', 'onboarding', 'interview-screen.tsx');
    expect(interview).not.toContain('A few things missing');
    expect(interview).not.toContain('Finish the basics');
    expect(interview).toContain('straightOn(over, state?.ready ?? false, fromFinish)');
    expect(interview).toContain('if (onward) router.replace(onward as Href);');
  });
});

describe('each step of the essentials', () => {
  it('opens at the top, lets the general note give way to the keyboard, and clears a note on typing', () => {
    const setup = src('features', 'onboarding', 'essentials-screen.tsx');
    expect(setup).toContain('<Screen key={q.key} topInset={false}');
    expect(setup).toContain('{!(generalNote && keyboard > 0) && <Text');
    expect(setup).toMatch(/onChangeText=\{\(t\) => \{\s*setNote\(null\);/);
  });

  it('says a failed or refused location in one line, which fits above Next with the keyboard up', () => {
    const setup = src('features', 'onboarding', 'essentials-screen.tsx');
    for (const line of ['Could not find you. Type your city.', 'No problem. Type your city instead.']) {
      expect(setup).toContain(`'${line}'`);
      expect(line.length).toBeLessThanOrEqual(40);
    }
    expect(setup).not.toContain('Could not work out where you are. Type your city instead.');
  });
});

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}
