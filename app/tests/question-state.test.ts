/**
 * The question of the day says how often it was asked -- never who asked.
 *
 * WHY (the founder, 2026-09-25): "never say who asked". The server has no column that
 * could say it (migration 0062, server/tests/question-of-day.test.ts); this pins that
 * the words on the screen are a count and nothing else.
 *
 * Negative controls, run by hand: questionReason naming "a practice profile" or an agent
 * -> "a count and nothing else" fails; unusedNote saying nothing for a contact detail ->
 * "tells them" fails; the card branch drawing a text box -> "opens the card" fails.
 */
import { describe, expect, it } from 'vitest';
import { cardReason, questionReason, unusedNote } from '../src/features/question/question-state';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

describe('a question on a card topic', () => {
  it('says how often, never who -- and that a card is checked, never seen', () => {
    for (const n of [1, 2, 4]) {
      const r = cardReason(n);
      // "who fits" is about the person reading it; what must never appear is an asker.
      expect(r).not.toMatch(/\b(he|she|someone|somebody|practice|named)\b|who asked/i);
      expect(r).toMatch(/nobody ever sees your answer/);
    }
    expect(cardReason(2)).toContain('twice');
  });

  it('opens the card, not a text box', () => {
    // No React Native renderer under vitest: the screen is read as source, comments out.
    const src = (f: string) => readFileSync(join(import.meta.dirname, '..', 'src', f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const screen = src('features/question/question-screen.tsx');
    const branch = screen.slice(screen.indexOf('q?.card ?'), screen.indexOf('q === null ?'));
    expect(branch).toMatch(/router\.replace\(\{ pathname: '\/onboarding\/interview', params: \{ card: q\.card!\.id, qotd: q\.id \} \}\)/);
    expect(branch, 'a card question drew a text box').not.toMatch(/<Field/);
    const interview = src('features/onboarding/interview-screen.tsx');
    expect(interview).toMatch(/getNextQuestion\(token, one\)/);
    expect(interview).toMatch(/markQuestionDone\(token, qotd\)/);
  });
});
