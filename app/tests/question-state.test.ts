/**
 * The question of the day says how often it was asked -- never who asked.
 *
 * WHY (the founder, 2026-09-25): "never say who asked". The server has no column that
 * could say it (migration 0062, server/tests/question-of-day.test.ts); this pins that
 * the words on the screen are a count and nothing else.
 *
 * Negative controls, run by hand: questionReason naming "a practice profile" or an agent
 * -> "a count and nothing else" fails; unusedNote saying nothing for a contact detail ->
 * "tells them" fails.
 */
import { describe, expect, it } from 'vitest';
import { questionReason, unusedNote } from '../src/features/question/question-state';

describe('why you are being asked', () => {
  it('is a count and nothing else', () => {
    expect(questionReason(1)).toContain('asked yours this once');
    expect(questionReason(2)).toContain('twice');
    expect(questionReason(5)).toContain('5 times');
    for (const n of [1, 2, 5]) {
      expect(questionReason(n)).not.toMatch(/\b(he|she|they|someone|somebody|who|practice|named|from)\b/i);
    }
  });
});

describe('an answer no agent will ever repeat', () => {
  it('tells them, and why -- and says nothing when it will be used', () => {
    expect(unusedNote('contact')).toMatch(/never repeat/);
    expect(unusedNote('private')).toMatch(/never repeat/);
    expect(unusedNote(null)).toBeNull();
    expect(unusedNote(undefined)).toBeNull();
  });
});
