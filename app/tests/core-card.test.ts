/**
 * A core card's partner box starts EMPTY, shows every option from the start, and Next
 * stays dead until it is answered.
 *
 * WHAT WAS WRONG. The interview asked about you, then -- on a separate screen, only for
 * four fields -- "Could you be with a smoker?", and turned the answer into "same as
 * me": a daily smoker who said No got a rule that only daily smokers passed. The five
 * core cards replace that with two boxes on one screen, and the second is where a hard
 * rule comes from. The design's one non-negotiable is that it arrives with nothing
 * chosen. Defaults stick (Johnson & Goldstein 2003); a box that came with everything
 * ticked would make everybody look more open than they are, and the smoker they would
 * have ruled out arrives as their agent not listening.
 *
 * AND THEN (2026-09-24) THE FOUNDER TRIED IT. The partner box opened on "Anyone is
 * fine" / "Let me choose" and hid its options behind the second: "why is it in the
 * partner the options shown only after I click let me choose. give the same boxes".
 * And a small "You" and "Who's fine" did not say whose box was which. Now both boxes
 * show the same options from the start, headed "You" and "Your partner"; the person
 * taps every option that is okay, or "All are okay".
 *
 * HOW IT IS GUARDED. The state lives in a pure module (features/onboarding/core-card.ts)
 * so the rule is tested as behaviour here, not on a phone. The screen that draws it
 * cannot be rendered under vitest -- there is no React Native renderer in the room --
 * so for the screen the test reads the source, with comments stripped (they name every
 * one of these calls while explaining the history), and checks that the card starts
 * from `emptyCard`, resets to it on every new question, submits only through
 * `cardAnswer`, sends the partner choice, and draws the partner options ungated.
 *
 * Negative controls, run 2026-09-23: make `emptyCard` open with `who: { kind: 'anyone' }`
 * -> "opens with nothing chosen" and "submit stays disabled" fail. Drop the
 * `s.who.kind !== 'unset'` term from `canSubmit` -> "submit stays disabled" fails. Put
 * the old single-row interview screen back -> the source checks fail.
 * Run 2026-09-24: wrap the partner options in `card.who.kind === 'choose' &&` again ->
 * "draws the partner options from the start" fails; let `toggleFine` keep an empty list
 * -> "unticking the last one" fails.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  allFine, canSubmit, cardAnswer, declineYou, emptyCard, isAllFine, isFine, pickYou,
  toggleFine, type CardState,
} from '../src/features/onboarding/core-card';

const FREQUENCY = ['never', 'rarely', 'sometimes', 'often', 'daily'];

/** Apply a list of taps in order, the way the screen's setCard(updater) calls do. */
const tap = (...steps: Array<(s: CardState) => CardState>): CardState =>
  steps.reduce((s, f) => f(s), emptyCard());
const all = (s: CardState) => allFine(s, FREQUENCY);
const fine = (v: string) => (s: CardState) => toggleFine(s, v, FREQUENCY);

describe("a core card's partner box", () => {
  it('opens with nothing chosen in either box, and no option ticked', () => {
    const s = emptyCard();
    expect(s.you).toEqual({ kind: 'unset' });
    expect(s.who).toEqual({ kind: 'unset' });
    expect(FREQUENCY.some((v) => isFine(s, v))).toBe(false);
    expect(isAllFine(s, FREQUENCY)).toBe(false);
    expect(canSubmit(s)).toBe(false);
    expect(cardAnswer(s)).toBeNull();
  });

  it('opens empty every time, not carrying a choice from the last card', () => {
    // The screen calls emptyCard() on every new question; a shared object that one
    // card mutated would leak its choice into the next.
    const a = emptyCard();
    const b = emptyCard();
    expect(a).not.toBe(b);
    expect(b.who.kind).toBe('unset');
  });

  it('submit stays disabled after the You box until an explicit partner choice', () => {
    const youOnly = tap((s) => pickYou(s, 'never', false));
    expect(youOnly.you).toEqual({ kind: 'picked', values: ['never'] });
    expect(canSubmit(youOnly)).toBe(false);
    expect(cardAnswer(youOnly)).toBeNull();

    const both = all(youOnly);
    expect(canSubmit(both)).toBe(true);
    expect(cardAnswer(both)).toEqual({ values: ['never'], whoFine: { anyone: true } });
  });

  it('submit stays disabled after the partner box until the You box is answered', () => {
    const whoOnly = tap(fine('never'));
    expect(canSubmit(whoOnly)).toBe(false);
    expect(canSubmit(pickYou(whoOnly, 'rarely', false))).toBe(true);
  });

  it('ticks exactly the options tapped, and sends them as the only ones okay', () => {
    const s = tap((x) => pickYou(x, 'never', false), fine('never'), fine('rarely'));
    expect(FREQUENCY.filter((v) => isFine(s, v))).toEqual(['never', 'rarely']);
    expect(cardAnswer(s)).toEqual({ values: ['never'], whoFine: { only: ['never', 'rarely'] } });
  });

  it('unticking the last one leaves the box unanswered, never answered with nobody', () => {
    const s = tap((x) => pickYou(x, 'never', false), fine('never'), fine('never'));
    expect(s.who).toEqual({ kind: 'unset' });
    expect(canSubmit(s)).toBe(false);
    expect(cardAnswer(s)).toBeNull();
  });

  it("keeps the card's own order, whatever order the taps came in", () => {
    const s = tap((x) => pickYou(x, 'often', false), fine('daily'), fine('never'), fine('sometimes'));
    expect(cardAnswer(s)?.whoFine).toEqual({ only: ['never', 'sometimes', 'daily'] });
  });

  it('"All are okay" ticks every option; unticking one from it keeps the rest', () => {
    const everyone = tap((x) => pickYou(x, 'never', false), all);
    expect(isAllFine(everyone, FREQUENCY)).toBe(true);
    expect(FREQUENCY.every((v) => isFine(everyone, v))).toBe(true);
    expect(cardAnswer(everyone)?.whoFine).toEqual({ anyone: true });

    const noDaily = fine('daily')(everyone);
    expect(cardAnswer(noDaily)?.whoFine).toEqual({ only: ['never', 'rarely', 'sometimes', 'often'] });
    expect(isAllFine(noDaily, FREQUENCY)).toBe(false);
    // Tapped with one missing, it ticks them all again; tapped with all ticked, it clears.
    expect(isAllFine(all(noDaily), FREQUENCY)).toBe(true);
    expect(all(all(noDaily)).who).toEqual({ kind: 'unset' });
  });

  it('every option ticked one by one shows as "All are okay"', () => {
    const s = tap(...FREQUENCY.map(fine));
    expect(isAllFine(s, FREQUENCY)).toBe(true);
  });

  it('"Prefer not to say" sends no values, and the partner choice is still required', () => {
    const declined = tap((s) => pickYou(s, 'daily', false), declineYou);
    expect(declined.you).toEqual({ kind: 'declined' });
    expect(canSubmit(declined)).toBe(false);
    expect(cardAnswer(all(declined))).toEqual({ values: [], whoFine: { anyone: true } });
    expect(cardAnswer(fine('never')(declined))).toEqual({ values: [], whoFine: { only: ['never'] } });
  });

  it('a single-choice You box replaces; a multi-choice one toggles back to unanswered', () => {
    expect(tap((s) => pickYou(s, 'yes', false), (s) => pickYou(s, 'no', false)).you)
      .toEqual({ kind: 'picked', values: ['no'] });
    expect(tap((s) => pickYou(s, 'a', true), (s) => pickYou(s, 'a', true)).you)
      .toEqual({ kind: 'unset' });
  });
});

/** The code with its comments removed. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('the interview screen draws a core card from that state', () => {
  const src = stripComments(readFileSync(
    join(import.meta.dirname, '..', 'src', 'features', 'onboarding', 'interview-screen.tsx'), 'utf8',
  ));

  it('starts every card from emptyCard, and resets to it on each new question', () => {
    expect(src).toMatch(/useState<CardState>\(emptyCard\)/);
    expect(src).toMatch(/setCard\(emptyCard\(\)\)/);
  });

  it('gates Next on cardAnswer, and sends the Who\'s-fine choice with it', () => {
    expect(src).toMatch(/const answer = core \? cardAnswer\(card\) : null/);
    expect(src).toMatch(/const ready = core\s*\?\s*answer !== null/);
    expect(src).toMatch(/disabled=\{!ready\}/);
    expect(src).toMatch(/submit\(answer\.values, undefined, answer\.whoFine\)/);
  });

  it('ticks the partner box only from a tap', () => {
    // Anywhere else -- in `load`, in an effect -- it would be a pre-ticked row.
    const body = src.replace(/import[\s\S]*?from\s+'[^']+';/g, '');
    const uses = body.split('\n').filter((l) => /\b(allFine|toggleFine)\b/.test(l));
    expect(uses.length).toBeGreaterThan(0);
    for (const l of uses) expect(l).toMatch(/onPress=/);
  });

  it('never builds a chosen Who row by hand, and sets the card only from a tap or to empty', () => {
    // The check above only sees a pre-tick that goes through the two named helpers.
    // Two others would slip past it: a literal row -- setCard({ ...emptyCard(), who:
    // { kind: 'anyone' } }) in `load` -- and a second setCard straight after the reset.
    // So: no Who literal in the screen at all, and every setCard is either a tap or
    // exactly the reset.
    expect(src).not.toMatch(/kind:\s*'(anyone|choose)'/);
    const sets = src.split('\n').filter((l) => /\bsetCard\(/.test(l));
    expect(sets.length).toBeGreaterThan(0);
    for (const l of sets) {
      expect(/onPress=/.test(l) || /^\s*setCard\(emptyCard\(\)\);\s*$/.test(l), `setCard outside a tap: ${l.trim()}`)
        .toBe(true);
    }
  });
});

describe('the interview screen says whose box is which', () => {
  const src = stripComments(readFileSync(
    join(import.meta.dirname, '..', 'src', 'features', 'onboarding', 'interview-screen.tsx'), 'utf8',
  ));

  it('heads the two boxes "You" and "Your partner"', () => {
    expect(src).toMatch(/>\s*You\s*<\/Text>/);
    expect(src).toMatch(/>\s*Your partner\s*<\/Text>/);
    expect(src).not.toMatch(/Who's fine/);
  });

  it('draws the partner options from the start, not behind "Let me choose"', () => {
    const partner = src.slice(src.indexOf('Your partner'));
    expect(partner).toMatch(/fine\.options\.map\(/);
    // The options sit in the box's first ChipGroup, with nothing deciding whether they
    // are drawn: no condition on the partner state before them.
    const before = partner.slice(0, partner.indexOf('fine.options.map('));
    expect(before).not.toMatch(/card\.who\.kind/);
    expect(src).not.toMatch(/Let me choose/);
  });
});
