/**
 * "What are you here for?" -- the same question, in the same words, wherever it is asked.
 *
 * WHAT WAS WRONG (the two-phone test, 2026-10-02). The onboarding cards (the server's
 * questions.ts) asked "What are you here for?" with "Something casual" and "Still working
 * it out"; the app's setup and profile asked "What are you after?" with "Casual" and
 * "Still deciding", and read the answer back in those words. One question, met twice,
 * worded two ways.
 *
 * WHAT IS GUARDED: the app asks it and reads it back in the shared words (INTENT_QUESTION,
 * INTENT_LABELS), which the server's cards use too (server/tests/intent-words.test.ts).
 *
 * Negative control, run by hand and recorded in the commit: the setup step back to "What
 * are you after?" with its own words -> both tests here fail.
 */
import { describe, expect, it } from 'vitest';
import { INTENT_LABELS, INTENT_QUESTION, RELATIONSHIP_INTENTS } from '@clone/shared';
import { FIELD_BY_KEY, label, missingLabel } from '../src/features/profile/fields';

describe('what are you here for', () => {
  it('setup and the profile editor ask it in the shared words, every answer included', () => {
    const field = FIELD_BY_KEY.get('relationship_intent')!;
    expect(field.title).toBe(INTENT_QUESTION);
    expect(field.options).toEqual(RELATIONSHIP_INTENTS.map((value) => ({ value, label: INTENT_LABELS[value] })));
  });

  it('the profile reads the answer back in the same words, and names it the same way when missing', () => {
    for (const v of RELATIONSHIP_INTENTS) expect(label(v)).toBe(INTENT_LABELS[v]);
    expect(missingLabel('relationship_intent')).toBe("What you're here for");
  });
});
