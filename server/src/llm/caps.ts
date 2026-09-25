/**
 * Model capability registry.
 *
 * The point of this file: a swap is a config change, and a capability the target
 * model cannot express RAISES instead of silently degrading.
 *
 * Every documented 2026 abstraction-layer failure was a degradation, not a crash --
 * the Vercel AI SDK relocated the first Anthropic cache breakpoint and deleted the
 * rest when merging tool messages; LiteLLM mapped a dict-valued reasoning_effort to
 * {} for Anthropic. Degradations do not throw. They show up on the invoice weeks
 * later. That is why the seam has to be ours.
 *
 * Anthropic values verified against platform.claude.com/docs/en/about-claude/pricing
 * and .../model-deprecations on 2026-09-07.
 */

export type Provider = 'anthropic' | 'openai' | 'google' | 'typesafe';
export type ModelRef = `${Provider}:${string}`;

export type Task = 'chat' | 'extract' | 'resolve' | 'reflect' | 'render_profile' | 'canon'
  /**
   * A TYPED DECISION, not a paragraph. Its model answers a map of closed questions
   * with probabilities and writes no text at all, so only `llm.decide` may use it and
   * `llm.complete` on such a model throws rather than degrading. See
   * `adapters/typesafe.ts`.
   */
  | 'decide';

export class UnsupportedCapability extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedCapability';
  }
}

export interface Price {
  /** USD per million tokens. */
  input: number;
  output: number;
  cacheWriteMultiplier: number;
  cacheReadMultiplier: number;
  batchDiscount: number;
  /** false = not confirmed against the vendor's live pricing page. Gates boot. */
  verified: boolean;
  verifiedOn?: string;
  source: string;
}

export interface Caps {
  price: Price;
  maxContext: number;
  maxOutput: number;

  cacheStyle: 'none' | 'explicit_breakpoints' | 'automatic_toplevel';
  /**
   * content_addressed: an identical prefix hits from anywhere.
   * machine_affine: the provider routes on a hash of initial tokens and a cache read
   * is not guaranteed -- which is why the cost model carries a 30% miss haircut for
   * OpenAI rather than assuming the advertised discount.
   */
  cacheScope: 'content_addressed' | 'machine_affine';
  /** Shorter prefixes cache SILENTLY -- no error, cache_write stays 0. CI gate G7. */
  minCacheableTokens: number;
  maxBreakpoints: number;
  cacheTtls: readonly string[];

  thinkingShape: 'none' | 'budget_tokens' | 'adaptive_effort' | 'always_on';
  supportsEffort: boolean;
  /**
   * Append {role:'system'} inside messages[] so a newly-learned fact lands AFTER the
   * cached prefix instead of invalidating it. Opus 5 yes, Sonnet 5 NO -- which is
   * exactly why P4 core-profile rebuild runs on cadence and never per write.
   */
  supportsMidConversationSystem: boolean;
  supportsNativeSchema: boolean;
  batchAvailable: boolean;

  /** Claude 4.7+ emit ~30% more tokens for identical text. Re-baseline on swap (G8). */
  tokenizerFamily: 'claude_4_7_plus' | 'claude_legacy' | 'openai' | 'gemini';
  /** CI gate G10: no routed model within 90 days of this date. */
  retirementDate?: string;
}

const ANTHROPIC_TTLS = ['5m', '1h'] as const;
const PRICING_DOC = 'https://platform.claude.com/docs/en/about-claude/pricing';

export const REGISTRY: Record<string, Caps> = {
  'anthropic:claude-opus-5': {
    price: {
      input: 5.0, output: 25.0,
      cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.1, batchDiscount: 0.5,
      verified: true, verifiedOn: '2026-09-07', source: PRICING_DOC,
    },
    maxContext: 1_000_000, maxOutput: 128_000,
    cacheStyle: 'explicit_breakpoints', cacheScope: 'content_addressed',
    minCacheableTokens: 512, maxBreakpoints: 4, cacheTtls: ANTHROPIC_TTLS,
    thinkingShape: 'adaptive_effort', supportsEffort: true,
    supportsMidConversationSystem: true, supportsNativeSchema: true, batchAvailable: true,
    tokenizerFamily: 'claude_4_7_plus', retirementDate: '2027-07-24',
  },
  'anthropic:claude-sonnet-5': {
    price: {
      input: 2.0, output: 10.0,
      cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.1, batchDiscount: 0.5,
      verified: true, verifiedOn: '2026-09-07', source: PRICING_DOC,
    },
    maxContext: 1_000_000, maxOutput: 128_000,
    cacheStyle: 'explicit_breakpoints', cacheScope: 'content_addressed',
    minCacheableTokens: 1024, maxBreakpoints: 4, cacheTtls: ANTHROPIC_TTLS,
    thinkingShape: 'adaptive_effort', supportsEffort: true,
    supportsMidConversationSystem: false, supportsNativeSchema: true, batchAvailable: true,
    tokenizerFamily: 'claude_4_7_plus', retirementDate: '2027-06-30',
  },
  // Present so the CI retirement gate can FAIL on it -- not so we route to it.
  // "Not sooner than October 15, 2026": the shortest horizon of any active Claude
  // model, against a published "at least 60 days' notice" policy. Do not build on it.
  'anthropic:claude-haiku-4-5': {
    price: {
      input: 1.0, output: 5.0,
      cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.1, batchDiscount: 0.5,
      verified: true, verifiedOn: '2026-09-07', source: PRICING_DOC,
    },
    maxContext: 200_000, maxOutput: 64_000,
    cacheStyle: 'explicit_breakpoints', cacheScope: 'content_addressed',
    minCacheableTokens: 4096, maxBreakpoints: 4, cacheTtls: ANTHROPIC_TTLS,
    // Thinking cannot be switched off on 3.x: passing thinkingBudget 0 fails the
    // whole request. Recorded here so nothing tries.
    thinkingShape: 'always_on', supportsEffort: false,
    supportsMidConversationSystem: false, supportsNativeSchema: true, batchAvailable: true,
    tokenizerFamily: 'claude_legacy', retirementDate: '2026-10-15',
  },
  /**
   * Gemini Flash. The cheap, high-volume worker: extraction, resolve, consolidation.
   *
   * Chosen over Cerebras and Grok for one reason beyond price -- it has an embeddings
   * endpoint. Anthropic does not, which is why this server has warned on every boot
   * that episodic recall is full-text only. One key closes both gaps.
   *
   * The -lite variant, because it is the cheapest thing with a free tier and the
   * work it carries -- pulling facts out of a paragraph -- is not where model quality
   * shows. gemini-2.5-* is retired for new API keys; Google's own 404 points here.
   *
   * PRICES VERIFIED 2026-09-14 against ai.google.dev/gemini-api/docs/pricing, paid
   * tier, Standard (not Batch): input $0.30 per 1M tokens, output $2.50 per 1M. They
   * had been carried as guesses since the routing moved to Gemini, with
   * ALLOW_UNVERIFIED_PRICING=true in the running config to let the server boot -- so
   * every cost figure the project quoted, including the per-pair number in the
   * rendezvous notes, rested on numbers nothing had checked. They happen to have been
   * right. That was luck, and it is now a fact with a date on it.
   */
  'google:gemini-3.5-flash-lite': {
    price: {
      input: 0.3, output: 2.5,
      // Implicit caching, applied by the provider rather than requested. The page
      // quotes cached input at $0.03 against $0.30 standard, which is the 0.25
      // multiplier below rounded to the published figure's precision -- keep the
      // multiplier, and re-check it if the cache line ever stops being a tenth.
      cacheWriteMultiplier: 1.0, cacheReadMultiplier: 0.25, batchDiscount: 0.5,
      verified: true,
      source: 'ai.google.dev/gemini-api/docs/pricing, paid tier Standard, fetched 2026-09-14',
    },
    maxContext: 1_000_000, maxOutput: 65_536,
    // No explicit breakpoints: Gemini caches a long prefix on its own and there is
    // nothing to place. Asking for one would be a no-op dressed as control.
    cacheStyle: 'automatic_toplevel', cacheScope: 'content_addressed',
    minCacheableTokens: 1024, maxBreakpoints: 0, cacheTtls: ['5m'],
    // Thinking cannot be switched off on 3.x: passing thinkingBudget 0 fails the
    // whole request. Recorded here so nothing tries.
    thinkingShape: 'always_on', supportsEffort: false,
    supportsMidConversationSystem: false, supportsNativeSchema: true, batchAvailable: true,
    tokenizerFamily: 'gemini',
  },
  /**
   * Jev. A System One model: `state` plus a map of typed questions in, a probability
   * per question out, in one round trip. It does not generate text, so `complete()`
   * on it raises -- `maxOutput: 0` is not a limit to work around, it is the shape of
   * the model.
   *
   * THE PRICE IS THE INTERESTING PART. $0.042 per million input tokens and output
   * free, against $2 in / $10 out for the model this system runs on. Scoring one
   * person against a thousand candidates is about four cents where the header of
   * `matching/candidates.ts` records it as seven dollars -- which is why that file
   * puts the whole filter in SQL. Whether a cheap typed judgement is any GOOD at this
   * is a separate question, and the reason `jev_file_score` is recorded on every pair
   * and read by nobody until there are enough human answers to measure it against.
   *
   * Verified against docs.typesafe.ai/models.md on 2026-09-23: "$42 / $0.042" per
   * billion and million input tokens, "Output tokens are free", "64k tokens per
   * request; 32k tokens for state plus the longest question".
   */
  'typesafe:jev-latest': {
    price: {
      input: 0.042, output: 0,
      // Nothing to multiply: there is no prompt cache and no batch endpoint.
      cacheWriteMultiplier: 1, cacheReadMultiplier: 1, batchDiscount: 1,
      verified: true, verifiedOn: '2026-09-23',
      source: 'https://docs.typesafe.ai/models.md',
    },
    maxContext: 64_000, maxOutput: 0,
    cacheStyle: 'none', cacheScope: 'content_addressed',
    minCacheableTokens: 0, maxBreakpoints: 0, cacheTtls: [],
    thinkingShape: 'none', supportsEffort: false,
    supportsMidConversationSystem: false, supportsNativeSchema: false, batchAvailable: false,
    // Not a transformer tokenizer we have re-baselined; usage is read from their
    // response and never estimated here.
    tokenizerFamily: 'openai',
  },
  /** The pinned version behind the alias, so a run can be reproduced. */
  'typesafe:jev-1.13.0': {
    price: {
      input: 0.042, output: 0,
      cacheWriteMultiplier: 1, cacheReadMultiplier: 1, batchDiscount: 1,
      verified: true, verifiedOn: '2026-09-23',
      source: 'https://docs.typesafe.ai/models.md',
    },
    maxContext: 64_000, maxOutput: 0,
    cacheStyle: 'none', cacheScope: 'content_addressed',
    minCacheableTokens: 0, maxBreakpoints: 0, cacheTtls: [],
    thinkingShape: 'none', supportsEffort: false,
    supportsMidConversationSystem: false, supportsNativeSchema: false, batchAvailable: false,
    tokenizerFamily: 'openai',
  },
  'openai:gpt-5.6-luna': {
    // UNVERIFIED. Confirm the model id and both prices against OpenAI's live pricing
    // page before routing to it; the app refuses to boot on an unverified price
    // unless ALLOW_UNVERIFIED_PRICING=true.
    price: {
      input: 0.2, output: 1.2,
      cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.1, batchDiscount: 0.5,
      verified: false,
      source: 'UNVERIFIED - research report, not confirmed against the vendor',
    },
    maxContext: 400_000, maxOutput: 128_000,
    cacheStyle: 'automatic_toplevel', cacheScope: 'machine_affine',
    minCacheableTokens: 1024, maxBreakpoints: 0, cacheTtls: ['30m'],
    thinkingShape: 'adaptive_effort', supportsEffort: true,
    supportsMidConversationSystem: false, supportsNativeSchema: true, batchAvailable: true,
    tokenizerFamily: 'openai',
  },
};

export function capabilities(model: ModelRef): Caps {
  const caps = REGISTRY[model];
  if (!caps) {
    throw new UnsupportedCapability(
      `${model} is not in the capability registry. Add it to src/llm/caps.ts with a ` +
        `verified price before routing to it.`,
    );
  }
  return caps;
}

export function providerOf(model: ModelRef): Provider {
  return model.split(':', 1)[0] as Provider;
}

export function modelIdOf(model: ModelRef): string {
  return model.slice(model.indexOf(':') + 1);
}

const PROVIDERS: readonly Provider[] = ['anthropic', 'openai', 'google', 'typesafe'];

export function isModelRef(spec: string): spec is ModelRef {
  const [p, ...rest] = spec.split(':');
  return PROVIDERS.includes(p as Provider) && rest.join(':').length > 0;
}

/** Days until retirement, or Infinity when none is published. CI gate G10. */
export function daysUntilRetirement(model: ModelRef, now = new Date()): number {
  const d = capabilities(model).retirementDate;
  if (!d) return Infinity;
  return Math.floor((Date.parse(d) - now.getTime()) / 86_400_000);
}
