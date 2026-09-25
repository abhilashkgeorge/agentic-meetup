/**
 * TypeSafe — Jev, a System One model.
 *
 * NOT A CHEAPER LLM. A different shape: unstructured `state` plus a map of closed
 * questions in, one probability per question out, in a single round trip. It gives up
 * string generation entirely, which is why `complete` and `stream` below RAISE instead
 * of doing something approximate. A model that cannot write a sentence must never be
 * handed a task that needs one -- the prober, the brief and the chat all stay where
 * they are.
 *
 * WHAT IT IS FOR HERE. Two places in this system want a calibrated number rather than
 * a paragraph, and both currently get a paragraph and throw most of it away:
 *
 *   - mapping a written dealbreaker onto a filter (onboarding/dealbreaker.ts). The
 *     only answer in the product allowed to remove people, and a wrong one is
 *     invisible -- so a confidence we can threshold on is worth more than prose.
 *   - the file scorer recorded on every pair (matching/score.ts), whose whole purpose
 *     is to find out whether something cheap predicts as well as five conversations.
 *
 * NO SDK. One POST and a JSON body. A dependency here would be a second place that
 * can silently reshape a request, which is the failure this directory exists to
 * prevent, and there is nothing to abstract: the API is one endpoint.
 *
 * Shape verified against docs.typesafe.ai/api.md and .../primitives/*.md on
 * 2026-09-23.
 */
import { env } from '../../env.js';
import { computeCost } from '../port.js';
import type {
  Answer, DecideRequest, DecideResponse, Event, LLMRequest, LLMResponse, Question, Usage,
} from '../port.js';
import { UnsupportedCapability, capabilities, modelIdOf, type ModelRef } from '../caps.js';

/**
 * Their wire shape. Kept as its own type so the difference between what they accept
 * and what this system asks for is visible in one place rather than inferred from a
 * template literal.
 */
interface WireQuestion {
  type: 'noul' | 'choice';
  instructions: string;
  criteria?: Record<string, string>;
}

interface WireAnswer {
  type?: string;
  noul?: number;
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}

interface WireResponse {
  model?: string;
  answers?: Record<string, WireAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

const toWire = (q: Question): WireQuestion =>
  q.kind === 'noul'
    ? { type: 'noul', instructions: q.instructions, ...(q.when ? { criteria: q.when } : {}) }
    : { type: 'choice', instructions: q.instructions, criteria: q.options };

/**
 * A number from the wire, or the value that means "no information".
 *
 * A missing or unreadable probability must never arrive as 0. Zero is a confident NO
 * in every one of these questions -- it would read as "they said no" rather than
 * "nothing came back", and on the dealbreaker path that is the difference between a
 * rule not being written and a rule being written backwards.
 */
const prob = (v: unknown, whenMissing: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : whenMissing;

export async function decide(req: DecideRequest, model: ModelRef): Promise<DecideResponse> {
  if (!env.TYPESAFE_API_KEY) {
    throw new Error('TYPESAFE_API_KEY is not set; cannot route to a typesafe: model');
  }
  const started = Date.now();

  const questions: Record<string, WireQuestion> = {};
  for (const [id, q] of Object.entries(req.questions)) questions[id] = toWire(q);

  const res = await fetch(env.TYPESAFE_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.TYPESAFE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ state: req.state, model: modelIdOf(model), questions }),
  });

  if (!res.ok) {
    // Their documented codes. 429 and 529 are the ones a caller may sensibly retry;
    // everything else is our mistake and retrying it just spends the attempt.
    const body = await res.text().catch(() => '');
    const retryable = res.status === 429 || res.status === 529;
    const err = new Error(
      `typesafe ${res.status}${retryable ? ' (retryable)' : ''}: ${body.slice(0, 300)}`,
    );
    (err as Error & { retryable?: boolean }).retryable = retryable;
    throw err;
  }

  const body = (await res.json()) as WireResponse;

  const answers: Record<string, Answer> = {};
  for (const [id, raw] of Object.entries(body.answers ?? {})) {
    const asked = req.questions[id];
    if (!asked) continue;                 // an answer to something we did not ask
    if (asked.kind === 'noul') {
      // 0.5 for a missing one: no information, which is what an absent answer is.
      answers[id] = { kind: 'noul', p: prob(raw.noul, 0.5) };
    } else {
      const probabilities: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw.probabilities ?? {})) probabilities[k] = prob(v, 0);
      // A choice outside the options we gave is dropped, not trusted. The whole
      // reason for a closed set is that the caller can rely on the answer being in it.
      const choice = raw.choice && raw.choice in asked.options ? raw.choice : '';
      answers[id] = {
        kind: 'choice',
        choice,
        // Zero confidence when the choice was unusable, so a caller thresholding on
        // confidence rejects it without needing to know why.
        confidence: choice ? prob(raw.confidence, 0) : 0,
        probabilities,
      };
    }
  }

  const inputTokens = body.usage?.input_tokens ?? 0;
  const outputTokens = body.usage?.output_tokens ?? 0;
  const caps = capabilities(model);
  const usage: Usage = {
    inputTokens,
    cachedReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens,
    reasoningTokens: 0,
    provider: 'typesafe',
    modelId: body.model ?? modelIdOf(model),
    // Through our own price table like everything else. Output is priced at 0 in
    // caps.ts rather than dropped here, so the day it stops being free the bill
    // changes in one place and the arithmetic below does not lie in the meantime.
    costUsd: computeCost(caps, {
      inputTokens, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens,
    }),
    latencyMs: Date.now() - started,
  };

  return { answers, usage };
}

/**
 * Rule 2, at its plainest. There is no degraded version of "write me a sentence" for
 * a model that does not write sentences.
 */
export function complete(_req: LLMRequest, model: ModelRef): Promise<LLMResponse> {
  throw new UnsupportedCapability(
    `${model} is a System One model: it returns typed decisions and generates no text. ` +
      `Use llm.decide, or route this task to a model that can write.`,
  );
}

export function stream(_req: LLMRequest, model: ModelRef): AsyncIterable<Event> {
  throw new UnsupportedCapability(`${model} cannot stream text; it generates none.`);
}
