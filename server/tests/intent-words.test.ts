/**
 * "What are you here for?" -- the onboarding card asks it in the words the app's setup
 * and profile use (shared INTENT_QUESTION, INTENT_LABELS; app/tests/intent-words.test.ts).
 *
 * WHAT WAS WRONG (the two-phone test, 2026-10-02): this card said "Something casual" and
 * "Still working it out" while the app said "Casual" and "Still deciding", under a
 * different question. The card's words were kept and moved to shared; this guards that the
 * card keeps taking them from there rather than from a list of its own that can drift.
 *
 * Negative control, run by hand and recorded in the commit: the card's own list back,
 * with "Casual" -> this test fails.
 */
import { describe, expect, it } from 'vitest';
import { INTENT_LABELS, INTENT_QUESTION, RELATIONSHIP_INTENTS } from '@clone/shared';
import { BY_ID } from '../src/onboarding/questions.js';

describe('the onboarding intent card', () => {
  it('asks in the shared words, every answer included, in order', () => {
    const q = BY_ID.get('q-intent')!;
    expect(q.text).toBe(INTENT_QUESTION);
    expect(q.options).toEqual(RELATIONSHIP_INTENTS.map((value) => ({ value, label: INTENT_LABELS[value] })));
  });
});
