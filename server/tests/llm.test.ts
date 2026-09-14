/**
 * CI gates for the swap seam. These are cheap, they run without an API key, and
 * they encode the failures that cost other people money silently.
 */
import { describe, expect, it } from 'vitest';
import {
  capabilities,
  daysUntilRetirement,
  UnsupportedCapability,
  type ModelRef,
} from '../src/llm/caps.js';
import { assertExpressible, computeCost, type LLMRequest } from '../src/llm/port.js';

const base: LLMRequest = {
  task: 'chat',
  instructions: 'x',
  messages: [{ role: 'user', content: 'hi' }],
  tenantId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
};

describe('cost is computed from our own price table', () => {
  it('prices an uncached Sonnet 5 call by hand-checkable arithmetic', () => {
    // 10k input @ $2/MTok = $0.02; 1k output @ $10/MTok = $0.01. Total $0.03.
    const cost = computeCost(capabilities('anthropic:claude-sonnet-5'), {
      inputTokens: 10_000,
      cachedReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1_000,
    });
    expect(cost).toBeCloseTo(0.03, 6);
  });

  it('charges cache reads at 0.1x and writes at 1.25x', () => {
    const caps = capabilities('anthropic:claude-sonnet-5');
    // 10k cached reads @ $2 * 0.1 = $0.002
    expect(
      computeCost(caps, {
        inputTokens: 0, cachedReadTokens: 10_000, cacheWriteTokens: 0, outputTokens: 0,
      }),
    ).toBeCloseTo(0.002, 6);
    // 10k cache writes @ $2 * 1.25 = $0.025 -- a write costs MORE than an uncached
    // read, which is why a 1-turn session makes caching a surcharge, not a saving.
    expect(
      computeCost(caps, {
        inputTokens: 0, cachedReadTokens: 0, cacheWriteTokens: 10_000, outputTokens: 0,
      }),
    ).toBeCloseTo(0.025, 6);
  });

  it('halves everything on the Batch API', () => {
    const caps = capabilities('anthropic:claude-sonnet-5');
    const args = {
      inputTokens: 10_000, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1_000,
    };
    expect(computeCost(caps, { ...args, batch: true })).toBeCloseTo(
      computeCost(caps, args) / 2, 6,
    );
  });
});

describe('rule 2: no silent degradation', () => {
  it('rejects effort on a model that has none', () => {
    // Haiku 4.5 errors on `effort`. A layer that dropped it would produce a
    // working call at the wrong quality and no error anywhere.
    expect(() =>
      assertExpressible({ ...base, effort: 'high' }, 'anthropic:claude-haiku-4-5'),
    ).toThrow(UnsupportedCapability);
  });

  it('rejects more breakpoints than the provider allows', () => {
    expect(() =>
      assertExpressible(
        {
          ...base,
          cache: [
            { scope: 'instructions', ttl: '5m' },
            { scope: 'tools', ttl: '5m' },
            { scope: 'history', ttl: '5m' },
            { scope: 'history', ttl: '5m' },
            { scope: 'history', ttl: '5m' },
          ],
        },
        'anthropic:claude-sonnet-5',
      ),
    ).toThrow(UnsupportedCapability);
  });

  it('rejects a TTL the provider does not offer', () => {
    // The Vercel AI Gateway silently downgraded the 1-hour Anthropic cache to 5
    // minutes. Silently. This is that class of bug, made loud.
    expect(() =>
      assertExpressible(
        { ...base, cache: [{ scope: 'instructions', ttl: '30m' }] },
        'anthropic:claude-sonnet-5',
      ),
    ).toThrow(/TTL/);
  });

  it('rejects an output request above the model cap', () => {
    expect(() =>
      assertExpressible({ ...base, maxOutputTokens: 200_000 }, 'anthropic:claude-sonnet-5'),
    ).toThrow(UnsupportedCapability);
  });

  it('accepts a well-formed request', () => {
    expect(() =>
      assertExpressible(
        { ...base, effort: 'low', cache: [{ scope: 'instructions', ttl: '5m' }] },
        'anthropic:claude-sonnet-5',
      ),
    ).not.toThrow();
  });
});

describe('gate G10: retirement horizon', () => {
  const routed: ModelRef[] = [
    process.env.CHAT_MODEL, process.env.EXTRACT_MODEL, process.env.RESOLVE_MODEL,
    process.env.REFLECT_MODEL, process.env.RENDER_PROFILE_MODEL, process.env.CANON_MODEL,
  ].filter((m): m is ModelRef => typeof m === 'string' && m.length > 0);

  it.each(routed)('%s is more than 90 days from retirement', (model) => {
    expect(daysUntilRetirement(model)).toBeGreaterThan(90);
  });

  it('flags Haiku 4.5, which is why we do not route to it', () => {
    // "Not sooner than October 15, 2026", against a 60-day notice policy: the
    // shortest horizon of any active Claude model.
    expect(daysUntilRetirement('anthropic:claude-haiku-4-5')).toBeLessThan(90);
  });
});

describe('gate G7: the cached prefix must clear the model minimum', () => {
  it('records each routed model minimum so a swap cannot silently stop caching', () => {
    // A prefix below the minimum caches SILENTLY: no error, cache_write stays 0,
    // and the only symptom is the invoice. Once the real prompt exists, assert its
    // token count against this number.
    expect(capabilities('anthropic:claude-sonnet-5').minCacheableTokens).toBe(1024);
    expect(capabilities('anthropic:claude-haiku-4-5').minCacheableTokens).toBe(4096);
  });
});
