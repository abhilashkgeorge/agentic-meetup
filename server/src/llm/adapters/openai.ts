/**
 * OpenAI adapter. The other file allowed to import a model SDK.
 *
 * NOTE: the routed OpenAI chat model and its price are UNVERIFIED (see caps.ts).
 * W1 defaults to Anthropic so the app boots on verified numbers. Confirm the model
 * id, its price, and this request shape before flipping CHAT_MODEL/EXTRACT_MODEL.
 *
 * The one thing that differs structurally from Anthropic, and the reason
 * normaliseUsage exists on both sides: OpenAI's `prompt_tokens` INCLUDES cached
 * tokens, Anthropic's `input_tokens` EXCLUDES them. Getting this backwards
 * double-counts or under-counts the cached portion on every single call.
 *
 * Caching here is automatic, not breakpointed, and `prompt_cache_key` only
 * "influences routing; it does not pin requests to a machine or guarantee a cache
 * read hit" -- hence cacheScope: 'machine_affine' and the cost model's 30% haircut.
 */
import OpenAI from 'openai';
import { env } from '../../env.js';
import { modelIdOf, type Caps, type ModelRef } from '../caps.js';
import {
  assertExpressible,
  computeCost,
  type Event,
  type LLMRequest,
  type LLMResponse,
  type Usage,
} from '../port.js';

// Constructed lazily. The SDK throws on a missing key at CONSTRUCTION, so a
// module-level client would make an OpenAI key mandatory just to boot -- even when
// every task is routed to Anthropic. Fail when the call is actually made, naming
// the setting that is missing.
let _client: OpenAI | undefined;
function client(): OpenAI {
  if (!_client) {
    if (!env.OPENAI_API_KEY) {
      throw new Error(
        'OPENAI_API_KEY is not set, but a task is routed to OpenAI (or embeddings ' +
          'are enabled). Set it, or point EMBEDDING_MODEL and the routed models elsewhere.',
      );
    }
    _client = new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 2 });
  }
  return _client;
}

interface RawUsage {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  prompt_tokens_details?: { cached_tokens?: number | null } | null;
  completion_tokens_details?: { reasoning_tokens?: number | null } | null;
}

function normaliseUsage(
  raw: RawUsage | undefined,
  caps: Caps,
  model: ModelRef,
  latencyMs: number,
  batch: boolean,
): Usage {
  const prompt = raw?.prompt_tokens ?? 0;
  const cachedReadTokens = raw?.prompt_tokens_details?.cached_tokens ?? 0;
  // Subtract: OpenAI's prompt_tokens is inclusive of the cached portion.
  const inputTokens = Math.max(0, prompt - cachedReadTokens);
  const outputTokens = raw?.completion_tokens ?? 0;
  return {
    inputTokens,
    cachedReadTokens,
    cacheWriteTokens: 0, // automatic caching: writes are not separately billed
    outputTokens,
    reasoningTokens: raw?.completion_tokens_details?.reasoning_tokens ?? 0,
    provider: 'openai',
    modelId: modelIdOf(model),
    costUsd: computeCost(caps, {
      inputTokens,
      cachedReadTokens,
      cacheWriteTokens: 0,
      outputTokens,
      batch,
    }),
    latencyMs,
  };
}

function buildParams(req: LLMRequest, model: ModelRef) {
  return {
    model: modelIdOf(model),
    max_completion_tokens: req.maxOutputTokens ?? 4096,
    messages: [
      { role: 'system' as const, content: req.instructions },
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    // Per-user key: concentrates one user's turns on a warm cache. It does NOT
    // guarantee a hit, and it deliberately destroys cross-user prefix sharing.
    prompt_cache_key: req.userId,
    ...(req.effort ? { reasoning_effort: req.effort } : {}),
  };
}

export async function complete(req: LLMRequest, model: ModelRef): Promise<LLMResponse> {
  const caps = assertExpressible(req, model);
  const started = Date.now();
  const res = await client().chat.completions.create({ ...buildParams(req, model), stream: false });
  return {
    text: res.choices[0]?.message?.content ?? '',
    usage: normaliseUsage(res.usage, caps, model, Date.now() - started, req.batch ?? false),
  };
}

export async function* stream(req: LLMRequest, model: ModelRef): AsyncIterable<Event> {
  const caps = assertExpressible(req, model);
  const started = Date.now();
  let raw: RawUsage | undefined;

  try {
    const s = await client().chat.completions.create({
      ...buildParams(req, model),
      stream: true,
      // Without this, the usage chunk is never sent and every call meters as $0.
      stream_options: { include_usage: true },
    });

    // Rule 4: iterate to TERMINATION. OpenAI sends the usage chunk AFTER the chunk
    // carrying finish_reason -- breaking on finish_reason is precisely the bug that
    // made LiteLLM under-report prompt tokens by 67%.
    for await (const chunk of s) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield { type: 'text.delta', text: delta };
      if (chunk.usage) raw = chunk.usage;
    }

    yield {
      type: 'usage.final',
      usage: normaliseUsage(raw, caps, model, Date.now() - started, req.batch ?? false),
    };
  } catch (err) {
    const status = (err as { status?: number }).status;
    yield {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
      retryable: status === 429 || (status !== undefined && status >= 500),
    };
  }
}

/**
 * Whether vector recall is possible at all.
 *
 * Anthropic does not offer an embeddings endpoint, so an all-Anthropic routing has no
 * vector search. That is a legitimate configuration, not a misconfiguration -- recall
 * degrades to full-text rather than failing the turn.
 */
export function embeddingsAvailable(): boolean {
  return env.OPENAI_API_KEY.length > 0;
}

/** Embeddings for Tier 0 recall. 3-small supports native dimension reduction. */
export async function embed(texts: readonly string[]): Promise<number[][]> {
  const res = await client().embeddings.create({
    model: modelIdOf(env.EMBEDDING_MODEL as ModelRef),
    input: [...texts],
    dimensions: env.EMBEDDING_DIMENSIONS,
  });
  return res.data.map((d) => d.embedding);
}
