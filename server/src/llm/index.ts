/**
 * The router. Call sites ask for a Task; this picks the model and the adapter.
 *
 * Boot-time guard: refuse to start on a routed model we cannot price. Rule 3 is
 * worthless if the table has a hole in it -- an unpriced model is silent,
 * unattributed spend, which for an unfunded solo developer is the actual risk.
 */
import { env } from '../env.js';
import {
  capabilities,
  daysUntilRetirement,
  isModelRef,
  providerOf,
  type Caps,
  type ModelRef,
  type Task,
} from './caps.js';
import type { Event, LLMPort, LLMRequest, LLMResponse } from './port.js';
import * as anthropic from './adapters/anthropic.js';
import * as openai from './adapters/openai.js';
import * as google from './adapters/google.js';

const ROUTING: Record<Task, string> = {
  chat: env.CHAT_MODEL,
  extract: env.EXTRACT_MODEL,
  resolve: env.RESOLVE_MODEL,
  reflect: env.REFLECT_MODEL,
  render_profile: env.RENDER_PROFILE_MODEL,
  canon: env.CANON_MODEL,
};

export function modelFor(task: Task): ModelRef {
  const spec = ROUTING[task];
  if (!isModelRef(spec)) {
    throw new Error(`bad model spec '${spec}' for task '${task}'; expected '<provider>:<id>'`);
  }
  return spec;
}

const adapters = { anthropic, openai, google } as const;

export const llm: LLMPort = {
  complete(req: LLMRequest, model: ModelRef): Promise<LLMResponse> {
    return adapters[providerOf(model)].complete(req, model);
  },
  stream(req: LLMRequest, model: ModelRef): AsyncIterable<Event> {
    return adapters[providerOf(model)].stream(req, model);
  },
  capabilities(model: ModelRef): Caps {
    return capabilities(model);
  },
};

/** Called once at boot, and asserted again in CI (eval gates G7 and G10). */
export function validateRouting(): void {
  const problems: string[] = [];
  for (const task of Object.keys(ROUTING) as Task[]) {
    const model = modelFor(task);
    const caps = capabilities(model);

    if (!caps.price.verified && !env.ALLOW_UNVERIFIED_PRICING) {
      problems.push(
        `  ${task} -> ${model}: price is UNVERIFIED (${caps.price.source}).\n` +
          `      Confirm it against the vendor's pricing page and set verified: true in\n` +
          `      src/llm/caps.ts, or set ALLOW_UNVERIFIED_PRICING=true to proceed anyway.`,
      );
    }

    const days = daysUntilRetirement(model);
    if (days < 90) {
      problems.push(
        `  ${task} -> ${model}: retires in ${days} days (${caps.retirementDate}).\n` +
          `      Providers give as little as 60 days' notice. Route elsewhere.`,
      );
    }
  }
  if (problems.length) {
    throw new Error(`Refusing to start:\n${problems.join('\n')}`);
  }
}

export { UnsupportedCapability } from './caps.js';
export type { Caps, ModelRef, Task } from './caps.js';
export * from './port.js';
