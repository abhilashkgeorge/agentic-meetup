/**
 * Gates G7, G9, G10 from RUBRIC.md. These need no API key and no money, so they run
 * on every commit -- unlike G0-G5, which drive the real extractor.
 *
 * All three guard SILENT failures. A prefix below the cache minimum, a schema outside
 * the provider's grammar subset, and a model nearing retirement all fail quietly:
 * the first shows up only on the invoice, the second only as degraded extraction, the
 * third only as a dead endpoint on a Tuesday.
 */
import { describe, expect, it } from 'vitest';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { capabilities, daysUntilRetirement, type ModelRef } from '../src/llm/caps.js';
import { EXTRACTION_PROMPT } from '../src/memory/extract.js';

const routed = (): ModelRef[] =>
  [
    process.env.CHAT_MODEL, process.env.EXTRACT_MODEL, process.env.RESOLVE_MODEL,
    process.env.REFLECT_MODEL, process.env.RENDER_PROFILE_MODEL, process.env.CANON_MODEL,
  ].filter((m): m is ModelRef => typeof m === 'string' && m.length > 0);

describe('G7: the cached prefix clears the model minimum', () => {
  it('the extraction prompt is long enough to cache on every routed model', () => {
    // Approximation, deliberately conservative: ~4 chars/token for English prose.
    // The exact count needs messages.count_tokens, which needs a key -- so this gate
    // catches "obviously too short", and the real number is asserted in the paid run.
    const estimate = EXTRACTION_PROMPT.length / 4;
    for (const model of new Set(routed())) {
      const min = capabilities(model).minCacheableTokens;
      expect(
        estimate,
        `extraction prompt ~${Math.round(estimate)} tokens vs ${model} minimum ${min}. ` +
          `Below the minimum it caches SILENTLY: no error, cache_write stays 0, and the ` +
          `only symptom is the bill.`,
      ).toBeGreaterThan(min * 1.2);
    }
  });
});

describe('G9: the extraction schema stays inside the provider grammar subset', () => {
  it('uses no constraint the provider will reject', async () => {
    const { z } = await import('zod');
    // Re-derive the shape the adapter actually sends.
    const Extraction = z.object({
      facts: z.array(
        z.object({
          predicate: z.string(),
          object_text: z.string(),
          stance: z.enum(['asserted', 'hedged', 'hypothetical', 'reported', 'negated']),
          hedge_span: z.string(),
          source_quote: z.string(),
          valid_from: z.string(),
        }),
      ),
      possibly_false: z.array(
        z.object({ predicate: z.string(), current_value: z.string(), why: z.string() }),
      ),
    });

    const json = JSON.stringify(zodOutputFormat(Extraction, 'extraction'));
    // Anthropic's grammar subset excludes recursion, minimum/maximum,
    // minLength/maxLength, external $ref, and array constraints beyond minItems 0|1.
    for (const banned of ['"minimum"', '"maximum"', '"minLength"', '"maxLength"', '"maxItems"']) {
      expect(json, `schema contains ${banned}, which the provider grammar rejects`)
        .not.toContain(banned);
    }
    expect(json).not.toMatch(/"\$ref"\s*:\s*"https?:/);
  });
});

describe('G10: no routed model is near retirement', () => {
  it.each([...new Set(routed())])('%s has more than 90 days left', (model) => {
    expect(daysUntilRetirement(model)).toBeGreaterThan(90);
  });
});

describe('the AI disclosure', () => {
  it('names every provider the router can actually reach', async () => {
    // Shown to a person before their first message. It said "processed by unknown"
    // because the label map had no entry for Google, which is where every task
    // routes -- a disclosure that names nobody.
    const { modelFor } = await import('../src/llm/index.js');
    const { providerOf } = await import('../src/llm/caps.js');
    const { DISCLOSED_TASKS, LABELLED_PROVIDERS } = await import('../src/api/config.js');

    const missing = [...new Set(DISCLOSED_TASKS.map((t) => providerOf(modelFor(t))))]
      .filter((p) => !LABELLED_PROVIDERS.has(p));

    expect(missing, `no display name for: ${missing.join(', ')}`).toEqual([]);
  });
});
