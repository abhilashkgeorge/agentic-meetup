/**
 * Ticking which answers are fine for a want: nothing arrives ticked, and every answer
 * ticked is said to be no rule.
 *
 * WHY (2026-09-26): a want tied to its question becomes a rule from the person's own
 * ticks (server tests/want-questions.test.ts). A box that arrives ticked is the answer
 * most people give (the core cards' reason too), so a want not yet tied opens empty.
 *
 * Negative controls, run 2026-09-26:
 *   - startTicks opening on every answer ticked     -> "nothing arrives ticked" fails
 *   - acceptsEverybody always false                 -> "says it is no rule" fails
 */
import { describe, expect, it } from 'vitest';
import { acceptsEverybody, canSave, startTicks, toggleTick, wantHeading, wantLine, type WantView } from '../src/features/preferences/wants-state';

const OPTIONS = [{ value: 'save-invest', label: 'Saved or invested' }, { value: 'pay-off', label: 'Pays off something' }, { value: 'treat', label: 'A treat' }];
const want = (over: Partial<WantView> = {}): WantView => ({
  text: 'a saver, not an impulse spender', kind: 'wants', private: false,
  question: { id: 'sit-windfall', text: 'You get an unexpected ₹50,000. What happens to most of it?', topic: 'Money', options: OPTIONS, multi: false },
  accepted: null, rule: null, ...over,
});

describe('ticking a want', () => {
  it('nothing arrives ticked; a tied want opens on what it holds', () => {
    expect(startTicks(want())).toEqual([]);
    expect(startTicks(want({ accepted: ['pay-off'] }))).toEqual(['pay-off']);
  });

  it('ticks and unticks in the question’s own order, and needs one tick to save', () => {
    let t = toggleTick([], 'treat', OPTIONS);
    t = toggleTick(t, 'save-invest', OPTIONS);
    expect(t).toEqual(['save-invest', 'treat']);
    expect(canSave(t)).toBe(true);
    expect(canSave(toggleTick(toggleTick(t, 'treat', OPTIONS), 'save-invest', OPTIONS))).toBe(false);
  });

  it('says every answer ticked is no rule', () => {
    expect(acceptsEverybody(['save-invest', 'pay-off', 'treat'], OPTIONS)).toBe(true);
    expect(acceptsEverybody(['save-invest'], OPTIONS)).toBe(false);
  });

  it('says what each want is checked against', () => {
    expect(wantLine(want())).toMatch(/Tick the answers/);
    expect(wantLine(want({ question: null }))).toMatch(/only move people down, never hide them/);
    expect(wantLine(want({ private: true, question: null }))).toMatch(/card/);
  });
});

// The founder's "Looking for" on the Pixel, 2026-09-30: "Not: \u201cSomeone who is not
// disciplined\u201d". Negative control, run by hand: the card back on its bare "Not: " -> the
// second assertion fails.
describe('a want as a heading', () => {
  it('says a not-want in words, and the card uses it', async () => {
    expect(wantHeading({ kind: 'not', text: 'Someone who is not disciplined' }))
      .toBe("You don't want: \u201cSomeone who is not disciplined\u201d");
    expect(wantHeading({ kind: 'wants', text: 'A saver' })).toBe('\u201cA saver\u201d');
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const card = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'preferences', 'wants-card.tsx'), 'utf8');
    expect(card).toContain('{wantHeading(w)}');
  });

  // Same screen, same day: "who you want to meet  -2600" with nothing saying what the
  // number is. Negative control, run by hand: the line removed -> this fails.
  it('says what the numbers under the reach are', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const screen = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'preferences', 'preferences-screen.tsx'), 'utf8');
    expect(screen).toMatch(/>Each rule leaves out:<\/Text>\s*\)\}\s*\{\(pool\?\.steps \?\? \[\]\)\.filter/);
  });
});
