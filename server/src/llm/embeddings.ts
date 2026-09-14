/**
 * Embeddings, from whichever provider has a key.
 *
 * Anthropic has no embeddings endpoint, so an all-Anthropic routing has always fallen
 * back to full-text recall and warned about it on every boot. Gemini has one, which is
 * most of why that adapter is worth having.
 *
 * Preference order is deliberate: Gemini first because it is the cheaper of the two
 * and because a deployment that has a Gemini key almost certainly wants it used.
 */
import { env } from '../env.js';
import * as google from './adapters/google.js';
import * as openai from './adapters/openai.js';

export function embeddingsAvailable(): boolean {
  return env.GEMINI_API_KEY.length > 0 || env.OPENAI_API_KEY.length > 0;
}

/** Which one is actually being used, for the boot log and the eval report. */
export function embeddingProvider(): 'google' | 'openai' | 'none' {
  if (env.GEMINI_API_KEY) return 'google';
  if (env.OPENAI_API_KEY) return 'openai';
  return 'none';
}

export async function embed(texts: readonly string[]): Promise<number[][]> {
  if (!texts.length) return [];
  if (env.GEMINI_API_KEY) return google.embed(texts);
  if (env.OPENAI_API_KEY) return openai.embed(texts);
  // Never silently returns empty vectors: a zero vector is a valid-looking value that
  // matches everything equally, which is worse than failing.
  throw new Error('No embeddings provider configured (set GEMINI_API_KEY or OPENAI_API_KEY)');
}
