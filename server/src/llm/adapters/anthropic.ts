/**
 * Anthropic adapter. One of exactly two files allowed to import a model SDK.
 *
 * Pitfalls encoded here so they cannot be re-introduced:
 *  - `temperature` / `top_p` / `top_k` return a 400 on Claude 4.7+. Never sent.
 *  - `budget_tokens` was removed on 4.7+; thinking is `{type:'adaptive'}` or
 *    `{type:'disabled'}`, and depth is controlled by `output_config.effort`.
 *  - Adaptive thinking is ON BY DEFAULT on Sonnet 5 and Opus 5, and thinking tokens
 *    bill at the OUTPUT rate. Output is already 30-45% of a Sonnet 5 bill, so a
 *    modest 500-token trace roughly doubles a chat turn. Chat sends thinking off.
 *  - Usage is read at stream TERMINATION. `message_delta` carries the final counts;
 *    stopping at the first stop_reason loses them (the LiteLLM 67% undercount).
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
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

// Lazy for the same reason as the OpenAI adapter: constructing a client must not
// be a precondition for booting a server that may never call this provider.
let _client: Anthropic | undefined;
function client(): Anthropic {
  if (!_client) {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set, but a task is routed to Anthropic.');
    }
    _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 });
  }
  return _client;
}

interface RawUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/**
 * Anthropic reports `input_tokens` EXCLUDING both cached reads and cache writes,
 * which is exactly the split computeCost() expects. Do not "helpfully" add them.
 */
function normaliseUsage(
  raw: RawUsage,
  caps: Caps,
  model: ModelRef,
  latencyMs: number,
  batch: boolean,
): Usage {
  const inputTokens = raw.input_tokens ?? 0;
  const cachedReadTokens = raw.cache_read_input_tokens ?? 0;
  const cacheWriteTokens = raw.cache_creation_input_tokens ?? 0;
  const outputTokens = raw.output_tokens ?? 0;
  return {
    inputTokens,
    cachedReadTokens,
    cacheWriteTokens,
    outputTokens,
    reasoningTokens: 0, // billed inside output_tokens; not separately reported
    provider: 'anthropic',
    modelId: modelIdOf(model),
    costUsd: computeCost(caps, {
      inputTokens,
      cachedReadTokens,
      cacheWriteTokens,
      outputTokens,
      batch,
    }),
    latencyMs,
  };
}

function buildParams(req: LLMRequest, model: ModelRef, caps: Caps) {
  // The system prompt is the stable prefix, so the instructions breakpoint goes on
  // its last block. Nothing volatile -- no date, no user name, no session id -- may
  // appear here: any byte change invalidates everything after it.
  const wantsInstructionCache = req.cache?.some((c) => c.scope === 'instructions');
  const ttl = req.cache?.find((c) => c.scope === 'instructions')?.ttl ?? '5m';

  const system: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: req.instructions,
      ...(wantsInstructionCache
        ? { cache_control: { type: 'ephemeral' as const, ttl: ttl as '5m' | '1h' } }
        : {}),
    },
  ];

  // A mid-conversation system message keeps the cached history prefix intact. On a
  // model without it (Sonnet 5) the caller must not have produced one -- fail loudly
  // rather than silently reordering the conversation.
  for (const m of req.messages) {
    if (m.role === 'system' && !caps.supportsMidConversationSystem) {
      throw new (class extends Error {})(
        `${model} does not support mid-conversation system messages; ` +
          `rebuild the core profile on cadence instead of injecting it mid-session`,
      );
    }
  }

  return {
    model: modelIdOf(model),
    max_tokens: req.maxOutputTokens ?? 4096,
    system,
    messages: req.messages.map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: m.content,
    })),
    // Adaptive is on by default on Sonnet 5 / Opus 5 and bills at the output rate.
    // Only pay for it where reasoning is the product (resolve), never on chat.
    thinking: req.thinking
      ? ({ type: 'adaptive' } as const)
      : ({ type: 'disabled' } as const),
    ...(req.effort ? { output_config: { effort: req.effort } } : {}),
  };
}

export async function complete(req: LLMRequest, model: ModelRef): Promise<LLMResponse> {
  const caps = assertExpressible(req, model);
  const started = Date.now();

  // Structured output goes through messages.parse, which CONSTRAINS generation to the
  // schema. Falling through to messages.create instead returns prose and no
  // parsed_output, and every caller then silently sees zero results -- which is
  // exactly what happened when this branch was lost to an editing slip. Extraction
  // reported success and committed nothing, for every session, undetected, because
  // the unit tests mock this module.
  if (req.outputSchema) {
    const parsed = await client().messages.parse({
      ...buildParams(req, model, caps),
      stream: false,
      output_config: {
        format: zodOutputFormat(req.outputSchema),
      },
    });
    if (parsed.parsed_output === undefined || parsed.parsed_output === null) {
      // Constrained generation did not produce a parseable object. Surface it rather
      // than returning an empty result that reads as "the user said nothing durable".
      throw new Error(
        `structured output produced no parsed_output (stop_reason=${parsed.stop_reason})`,
      );
    }
    return {
      text: '',
      parsed: parsed.parsed_output,
      usage: normaliseUsage(parsed.usage, caps, model, Date.now() - started, req.batch ?? false),
    };
  }

  const msg = await client().messages.create({ ...buildParams(req, model, caps), stream: false });
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return {
    text,
    usage: normaliseUsage(msg.usage, caps, model, Date.now() - started, req.batch ?? false),
  };
}

export async function* stream(req: LLMRequest, model: ModelRef): AsyncIterable<Event> {
  const caps = assertExpressible(req, model);
  const started = Date.now();

  let s: ReturnType<ReturnType<typeof client>['messages']['stream']>;
  try {
    s = client().messages.stream(buildParams(req, model, caps));
  } catch (err) {
    yield { type: 'error', message: String(err), retryable: false };
    return;
  }

  try {
    for await (const ev of s) {
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
        yield { type: 'text.delta', text: ev.delta.text };
      } else if (ev.type === 'content_block_delta' && ev.delta.type === 'thinking_delta') {
        yield { type: 'reasoning.delta', text: ev.delta.thinking };
      }
    }
    // Rule 4: read usage at TERMINATION. finalMessage() resolves only after the
    // stream closes, so the message_delta usage counts are complete here.
    const final = await s.finalMessage();
    yield {
      type: 'usage.final',
      usage: normaliseUsage(final.usage, caps, model, Date.now() - started, req.batch ?? false),
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
