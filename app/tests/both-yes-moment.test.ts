/**
 * "You both said yes" is a moment -- and still says nothing about how the two will get
 * on, costs nobody their reduce-motion setting, and fetches nothing new.
 *
 * WHY (build list item 12): "match reveal as a moment (design only, no new data)".
 *
 * WHY PART OF IT IS THE SOURCE: no React Native renderer runs under vitest, so the
 * animation cannot be watched; what is pinned is its plan, its words, and that the
 * component asks the phone's reduce-motion setting and imports no data call.
 *
 * Negative controls, run 2026-09-25:
 *   - momentPlan ignoring reduce-motion                     -> "reduce motion" fails
 *   - the moment importing a data call from lib/api          -> "no new data" fails
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MOMENT_TITLE, momentLine, momentPlan } from '../src/features/matches/moment';

const JUDGING = /\b(match(es|ed)?|chemistry|click(s|ed)?|compatib\w*|worth it|got on|get on|perfect|great fit|soul ?mates?|meant to be)\b/i;
const code = (f: string) => readFileSync(join(import.meta.dirname, '..', 'src', f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('the moment', () => {
  it('moves in three beats, and not at all with reduce motion on', () => {
    const plan = momentPlan(false);
    expect(plan.slideMs).toBeGreaterThan(0);
    expect(plan.popMs).toBeGreaterThan(0);
    expect(plan.textMs).toBeGreaterThan(0);
    expect(momentPlan(true)).toEqual({ slideMs: 0, popMs: 0, textMs: 0, startShare: 0 });
    expect(code('features/matches/both-yes-moment.tsx')).toMatch(/AccessibilityInfo\.isReduceMotionEnabled\(\)/);
  });

  it('says the same thing to everybody, judging nobody', () => {
    expect(MOMENT_TITLE).toBe('You both said yes');
    expect(momentLine('Asha')).toBe('Asha can message you now, and nobody else can.');
    expect(momentLine(null)).toBe('They can message you now, and nobody else can.');
    for (const t of [MOMENT_TITLE, momentLine('Asha')]) {
      expect(t).not.toMatch(JUDGING);
      expect(t).not.toMatch(/\d|%/);
    }
  });

  it('no new data: the moment fetches nothing, and the reveal hands it what it has', () => {
    const moment = code('features/matches/both-yes-moment.tsx');
    // Types only from lib/api: no call that could reach the server.
    expect(moment).not.toMatch(/import\s+\{[^}]*\}\s+from '..\/..\/lib\/api'/);
    expect(moment).not.toMatch(/\bfetch\(/);
    const reveal = code('features/matches/reveal-screen.tsx');
    expect(reveal).toMatch(/<BothYesMoment name=\{them\?\.name\} theirLook=\{them\?\.look\} myLook=\{myLook\}/);
  });
});
