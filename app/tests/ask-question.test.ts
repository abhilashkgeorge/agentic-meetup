/**
 * A question somebody's want needed, as the question of the day: its own words.
 *
 * WHY (2026-09-26): a situation question is not "one of your cards", and it never says
 * whose want it was (server tests/asked-question-of-day.test.ts). This pins the words.
 *
 * Negative control, run 2026-09-26: the screen showing cardReason for every card-style
 * question -> "not one of your cards" fails.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { askReason, isAskQuestion } from '../src/features/question/question-state';

describe('an asked question of the day', () => {
  it('is told apart by its id, and says one tap and nobody sees it -- never whose', () => {
    expect(isAskQuestion('ask:sit-windfall')).toBe(true);
    expect(isAskQuestion('card:smoking')).toBe(false);
    for (const n of [1, 2, 7]) {
      const r = askReason(n);
      expect(r).toMatch(/One tap/);
      expect(r).toMatch(/Nobody ever sees your answer/);
      expect(r).not.toMatch(/card|\d/);
    }
  });

  it('is not called one of your cards on the screen', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'question', 'question-screen.tsx'), 'utf8');
    expect(src).toMatch(/isAskQuestion\(q\.id\) \? askReason\(q\.count\) : cardReason\(q\.count\)/);
  });
});
