/**
 * Gemini.
 *
 * Carries the cheap, high-volume work — extraction, resolve, consolidation — and the
 * embeddings that Anthropic has no endpoint for. That second half is why this adapter
 * exists at all: every boot until now has warned that episodic recall was full-text
 * only, because an all-Anthropic routing has nothing to embed with.
 *
 * THE SHAPE DIFFERENCES THAT MATTER, and why each is handled here rather than leaked
 * into the calling code:
 *
 *   - The system prompt is `systemInstruction`, not a first message.
 *   - Assistant turns are role 'model'.
 *   - Structured output is `responseSchema` + `responseMimeType`, and it wants an
 *     OpenAPI-ish schema rather than raw JSON Schema, so a zod schema is converted.
 *   - Caching is implicit. There is no breakpoint to place, so cache directives are
 *     accepted and ignored rather than faked.
 */
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { env } from '../../env.js';
import { computeCost } from '../port.js';
import type { Event, LLMRequest, LLMResponse, Message, Usage } from '../port.js';
import { capabilities, type ModelRef } from '../caps.js';

let cached: GoogleGenAI | null = null;
const client = (): GoogleGenAI => {
  if (!env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set; cannot route to a google: model');
  }
  cached ??= new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return cached;
};

const modelId = (model: ModelRef): string => model.split(':')[1]!;

/** Their turn roles: the assistant is 'model', and there is no system role at all. */
const toContents = (messages: readonly Message[]) =>
  messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

/**
 * zod → the schema dialect Gemini wants.
 *
 * Deliberately narrow: it covers the shapes our extraction prompts actually use and
 * throws on anything else, rather than silently emitting a schema that permits more
 * than intended. A structured-output schema that is quietly wrong produces plausible
 * objects with missing fields, which is the worst failure available here.
 */
export function toGeminiSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = (schema as { _def?: { typeName?: string } })._def;
  const typeName = def?.typeName ?? (schema as { type?: string }).type;

  if (schema instanceof z.ZodString) return { type: 'STRING' };
  if (schema instanceof z.ZodNumber) return { type: 'NUMBER' };
  if (schema instanceof z.ZodBoolean) return { type: 'BOOLEAN' };
  if (schema instanceof z.ZodEnum) {
    // zod v4 exposes enum members as an object rather than a tuple.
    return { type: 'STRING', enum: Object.values((schema as z.ZodEnum).enum) as string[] };
  }
  if (schema instanceof z.ZodArray) {
    return { type: 'ARRAY', items: toGeminiSchema(schema.element as unknown as z.ZodTypeAny) };
  }
  // Wrappers. zod v4's generic parameters do not survive a direct cast, so the
  // unwrap goes through `unknown` -- the runtime shape is what matters here.
  // NULLABLE MEANS THE MODEL MAY ANSWER NOTHING, and Gemini's schema says so with
  // `nullable`. It used to be unwrapped like an optional and then listed as required,
  // so the answer sheet's `sentence` -- a number, or null for "I don't know" -- could
  // only ever be a number: the one answer its prompt calls always safe could not be
  // given, and a model forced to pick one picks a sentence that does not answer.
  if (schema instanceof z.ZodNullable) {
    return { ...toGeminiSchema((schema as unknown as { unwrap: () => z.ZodTypeAny }).unwrap()), nullable: true };
  }
  if (schema instanceof z.ZodOptional) {
    return toGeminiSchema((schema as unknown as { unwrap: () => z.ZodTypeAny }).unwrap());
  }
  if (schema instanceof z.ZodDefault) {
    return toGeminiSchema(
      (schema as unknown as { removeDefault: () => z.ZodTypeAny }).removeDefault(),
    );
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as unknown as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = toGeminiSchema(value);
      const optional = value instanceof z.ZodOptional || value instanceof z.ZodDefault;
      if (!optional) required.push(key);
    }
    return { type: 'OBJECT', properties, required };
  }

  throw new Error(
    `No Gemini schema mapping for ${String(typeName)}. Add it explicitly rather than ` +
      `letting an unconstrained schema through.`,
  );
}

const usageFrom = (raw: unknown, model: ModelRef, latencyMs: number): Usage => {
  const u = (raw ?? {}) as {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  const inputTokens = (u.promptTokenCount ?? 0) - (u.cachedContentTokenCount ?? 0);
  return {
    inputTokens: Math.max(0, inputTokens),
    cachedReadTokens: u.cachedContentTokenCount ?? 0,
    cacheWriteTokens: 0,
    outputTokens: u.candidatesTokenCount ?? 0,
    reasoningTokens: u.thoughtsTokenCount ?? 0,
    provider: 'google',
    modelId: modelId(model),
    costUsd: computeCost(capabilities(model), {
      inputTokens: Math.max(0, inputTokens),
      cachedReadTokens: u.cachedContentTokenCount ?? 0,
      cacheWriteTokens: 0,
      outputTokens: u.candidatesTokenCount ?? 0,
    }),
    latencyMs,
  };
};

export async function complete(req: LLMRequest, model: ModelRef): Promise<LLMResponse> {
  const started = Date.now();
  const config: Record<string, unknown> = {
    systemInstruction: req.instructions,
    ...(req.maxOutputTokens !== undefined ? { maxOutputTokens: req.maxOutputTokens } : {}),
    // NOT thinkingConfig.thinkingBudget = 0.
    //
    // That is the documented way to switch thinking off on Gemini 2.5, and every 3.x
    // model rejects the whole request with a bare "invalid argument" -- no mention of
    // which argument. Thinking is not optional on these, so `thinking: false` is
    // honoured by keeping the reply short rather than by pretending to disable it.
    // The thought tokens are counted in usage and therefore in the bill.
  };

  if (req.outputSchema) {
    config.responseMimeType = 'application/json';
    config.responseSchema = toGeminiSchema(req.outputSchema);
  }

  const res = await client().models.generateContent({
    model: modelId(model),
    contents: toContents(req.messages),
    config,
  });

  const text = res.text ?? '';
  const usage = usageFrom(res.usageMetadata, model, Date.now() - started);

  if (req.outputSchema) {
    // Gemini returns JSON as text even with a response schema. Parsing failure is a
    // hard error, never a silent empty result: a caller handed a schema because it
    // needs the object, and a quietly-empty parse becomes missing facts.
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        `structured output did not parse as JSON (finish=${res.candidates?.[0]?.finishReason}). ` +
          `First 200 chars: ${text.slice(0, 200)}`,
      );
    }
    return { text: '', parsed, usage };
  }

  return { text, parsed: null, usage };
}

export async function* stream(req: LLMRequest, model: ModelRef): AsyncIterable<Event> {
  const started = Date.now();
  const iterable = await client().models.generateContentStream({
    model: modelId(model),
    contents: toContents(req.messages),
    config: {
      systemInstruction: req.instructions,
      ...(req.maxOutputTokens !== undefined ? { maxOutputTokens: req.maxOutputTokens } : {}),
    },
  });

  let lastUsage: unknown = null;

  // Normalised into the port's closed event set. Every adapter emits exactly these,
  // which is what lets the chat loop be written once rather than per provider.
  for await (const chunk of iterable) {
    const piece = chunk.text ?? '';
    if (piece) yield { type: 'text.delta', text: piece };
    if (chunk.usageMetadata) lastUsage = chunk.usageMetadata;
  }

  yield { type: 'usage.final', usage: usageFrom(lastUsage, model, Date.now() - started) };
}

/**
 * Embeddings — the reason this adapter is worth more than a price comparison.
 *
 * `outputDimensionality` is set explicitly so the vectors match the halfvec(768)
 * column that already exists. A model returning 3072 dimensions into a 768 column is
 * a runtime error on every insert, which is a bad way to find out.
 */
export async function embed(texts: readonly string[]): Promise<number[][]> {
  if (!texts.length) return [];
  // Read from the routing config rather than hardcoded, so the embedding model is
  // swappable in one place like every other model in this system. Noted 2026-09-14:
  // Google's pricing page now lists `gemini-embedding-2` and no longer shows
  // `gemini-embedding-001`, which is the configured default. The old id still
  // answers, but it is on a clock -- and unlike the chat models, nothing checks an
  // embedding model's retirement date, because embeddings never go through the
  // capability table.
  const res = await client().models.embedContent({
    model: env.EMBEDDING_MODEL.replace(/^google:/, ''),
    contents: texts.map((t) => ({ parts: [{ text: t }] })),
    config: { outputDimensionality: env.EMBEDDING_DIMENSIONS },
  });
  return (res.embeddings ?? []).map((e) => e.values ?? []);
}

export const embeddingsAvailable = (): boolean => env.GEMINI_API_KEY.length > 0;
