/**
 * A nullable field reaches Gemini as nullable.
 *
 * WHAT WAS WRONG (found 2026-09-24, building the agents' talk). The adapter unwrapped a
 * nullable field like an optional one and then listed it as required, so the model was
 * told the field must hold a value. The answer sheet's `sentence` is "a number, or
 * null": null is how a question gets "I don't know", and its prompt calls null always
 * safe -- but the schema made null impossible, so a model that had no answer had to
 * point at a sentence anyway.
 *
 * Pure: the conversion only, no call. Negative control, run 2026-09-24: drop the
 * `nullable: true` -> "a nullable field" fails.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const { toGeminiSchema } = await import('../src/llm/adapters/google.js');

describe('toGeminiSchema', () => {
  it('a nullable field is nullable, and still required', () => {
    const s = toGeminiSchema(z.object({ sentence: z.number().int().nullable(), question: z.string() }));
    expect(s).toEqual({
      type: 'OBJECT',
      properties: { sentence: { type: 'NUMBER', nullable: true }, question: { type: 'STRING' } },
      required: ['sentence', 'question'],
    });
  });

  it('an optional field is left out of required, and is not marked nullable', () => {
    const s = toGeminiSchema(z.object({ a: z.string().optional(), b: z.string() }));
    expect(s).toEqual({ type: 'OBJECT', properties: { a: { type: 'STRING' }, b: { type: 'STRING' } }, required: ['b'] });
  });

  it('keeps the talk schema, which has no nullable field, exactly as it was', async () => {
    const { TalkOut } = await import('../src/matching/talk.js');
    expect(JSON.stringify(toGeminiSchema(TalkOut))).not.toContain('nullable');
  });
});
