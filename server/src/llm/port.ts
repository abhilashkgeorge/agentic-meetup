/**
 * THE swap seam.
 *
 * `src/llm/` is the only directory permitted to import a model SDK. Everything else
 * passes a Task and never names a model, so a swap is a config change.
 *
 * Six rules:
 *   1. Call sites pass a Task, never a model.
 *   2. No silent degradation -- throw UnsupportedCapability.
 *   3. costUsd from OUR price table, never the library's.
 *   4. Streaming normalises to a closed event set; usage is read at stream
 *      TERMINATION, never at finish_reason.
 *   5. capabilities() asserted in CI (gates G7-G10).
 *   6. The per-tenant daily cap is enforced before the call, in src/metering.ts.
 */
import type { z } from 'zod';
import type { Caps, ModelRef, Task } from './caps.js';
import { capabilities, UnsupportedCapability } from './caps.js';

export type CacheScopeName = 'instructions' | 'tools' | 'history';

export interface CacheHint {
  scope: CacheScopeName;
  ttl: '5m' | '1h' | '30m';
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMRequest {
  task: Task;
  instructions: string;
  messages: readonly Message[];
  /**
   * REQUIRED. The budget gate needs them and a metering row is written per call.
   * There is no unattributed LLM call in this system.
   */
  tenantId: string;
  userId: string;
  tools?: readonly unknown[];
  /** Zod, not JSON Schema: provider-neutral, and each adapter converts with its own
   *  vendor helper. Keep schemas inside Anthropic's grammar subset -- no recursion,
   *  no min/max, no minLength/maxLength, no external $ref (CI gate G9). */
  outputSchema?: z.ZodType;
  outputSchemaName?: string;
  outputMode?: 'native' | 'tool' | 'prompted';
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  cache?: readonly CacheHint[];
  maxOutputTokens?: number;
  thinking?: boolean;
  batch?: boolean;
}

export interface Usage {
  inputTokens: number;
  cachedReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  provider: string;
  modelId: string;
  costUsd: number;
  latencyMs: number;
}

export interface LLMResponse {
  text: string;
  parsed?: unknown;
  usage: Usage;
}

// ── Closed streaming event set (rule 4). Adapters normalise into exactly these. ──
export type Event =
  | { type: 'text.delta'; text: string }
  | { type: 'reasoning.delta'; text: string }
  | { type: 'tool.start'; id: string; name: string }
  | { type: 'tool.delta'; id: string; partialJson: string }
  | { type: 'tool.end'; id: string }
  | { type: 'usage.final'; usage: Usage }
  | { type: 'error'; message: string; retryable: boolean };

// ── typed decisions (the `decide` task) ─────────────────────────────────────
//
// A DIFFERENT SHAPE OF MODEL, given its own entry point rather than squeezed into
// `complete`. A System One model takes unstructured state plus a map of closed
// questions and returns a probability for each, in one round trip; it generates no
// text at all. Pretending that is a chat completion is exactly the silent degradation
// rule 2 exists to prevent -- there would be no honest way to return `text`.
//
// Two question types are used here. Their API has a third (`score`, a rubric) which
// nothing needs yet and is therefore not in this type: a port that can express more
// than the code uses is a port nobody has tested.

/** Yes or no, answered as a probability. */
export interface NoulQuestion {
  kind: 'noul';
  /** A STATEMENT, phrased so that "more true" means a higher number. */
  instructions: string;
  /** Where the boundary is, when it is subtle. */
  when?: { true: string; false: string };
}

/** One option out of a closed set, with the distribution over all of them. */
export interface ChoiceQuestion {
  kind: 'choice';
  instructions: string;
  /** option -> what that option means. The model may return no other string. */
  options: Record<string, string>;
}

export type Question = NoulQuestion | ChoiceQuestion;

export interface DecideRequest {
  /** What is being judged. Free text; never a prompt telling it how to answer. */
  state: string;
  questions: Record<string, Question>;
  /** REQUIRED, as for `complete`. There is no unattributed model call here either. */
  tenantId: string;
  userId: string;
}

export type Answer =
  /** 1 is certainly true, 0 certainly false, 0.5 no information. */
  | { kind: 'noul'; p: number }
  | {
      kind: 'choice';
      /** The option with the highest probability. */
      choice: string;
      /** 0-1, from how spread the distribution is. Low means "it is guessing". */
      confidence: number;
      probabilities: Record<string, number>;
    };

export interface DecideResponse {
  answers: Record<string, Answer>;
  usage: Usage;
}

export interface LLMPort {
  complete(req: LLMRequest, model: ModelRef): Promise<LLMResponse>;
  stream(req: LLMRequest, model: ModelRef): AsyncIterable<Event>;
  /** Only a model whose adapter implements it; every other one raises. */
  decide(req: DecideRequest, model: ModelRef): Promise<DecideResponse>;
  capabilities(model: ModelRef): Caps;
}

/**
 * Cost from OUR price table.
 *
 * Never trust a library's number. LiteLLM undercounted OpenRouter prompt tokens by
 * 67% (4,469 reported vs 13,797 actual) because usage arrives in a chunk AFTER
 * finish_reason and it stopped iterating; LangChain reported cache_creation = 0 on a
 * real 1,875-token write.
 *
 * `inputTokens` must be the UNCACHED portion -- providers report the split
 * differently, so each adapter normalises before calling this.
 *
 * float64 is exact enough here (a per-call cost is ~1e-3 with 53 bits of mantissa);
 * accumulation happens in Postgres numeric(12,6), not in JS.
 */
export function computeCost(
  caps: Caps,
  u: {
    inputTokens: number;
    cachedReadTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
    batch?: boolean;
  },
): number {
  const p = caps.price;
  const raw =
    (u.inputTokens * p.input +
      u.cachedReadTokens * p.input * p.cacheReadMultiplier +
      u.cacheWriteTokens * p.input * p.cacheWriteMultiplier +
      u.outputTokens * p.output) /
    1_000_000;
  const cost = u.batch ? raw * p.batchDiscount : raw;
  return Math.round(cost * 1e6) / 1e6;
}

/**
 * Rule 2. Every way this request could be silently downgraded, thrown instead.
 * Called by every adapter before it builds a provider payload.
 */
export function assertExpressible(req: LLMRequest, model: ModelRef): Caps {
  const caps = capabilities(model);

  for (const hint of req.cache ?? []) {
    if (caps.cacheStyle === 'none') {
      throw new UnsupportedCapability(`${model} cannot cache; request asked for ${hint.scope}`);
    }
    if (caps.cacheStyle === 'explicit_breakpoints' && (req.cache?.length ?? 0) > caps.maxBreakpoints) {
      throw new UnsupportedCapability(
        `${model} allows ${caps.maxBreakpoints} breakpoints; asked for ${req.cache?.length}`,
      );
    }
    if (caps.cacheTtls.length && !caps.cacheTtls.includes(hint.ttl)) {
      throw new UnsupportedCapability(
        `${model} supports TTLs [${caps.cacheTtls.join(', ')}]; asked for '${hint.ttl}'`,
      );
    }
  }

  if (req.effort !== undefined && !caps.supportsEffort) {
    throw new UnsupportedCapability(`${model} has no effort parameter; asked for '${req.effort}'`);
  }

  if (req.batch && !caps.batchAvailable) {
    throw new UnsupportedCapability(`${model} has no Batch API`);
  }

  if (req.outputSchema && (req.outputMode ?? 'native') === 'native' && !caps.supportsNativeSchema) {
    throw new UnsupportedCapability(
      `${model} has no native structured output; set outputMode: 'tool'`,
    );
  }

  const want = req.maxOutputTokens ?? 4096;
  if (want > caps.maxOutput) {
    throw new UnsupportedCapability(`${model} caps output at ${caps.maxOutput}; asked for ${want}`);
  }

  return caps;
}
