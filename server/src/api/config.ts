import { Hono } from 'hono';
import { decideModel, modelFor } from '../llm/index.js';
import { providerOf, type Task } from '../llm/caps.js';
import { embeddingProvider } from '../llm/embeddings.js';

/**
 * Every task whose provider a person is told about. Exported so a test can check that
 * each one has a display name rather than falling through to "unknown".
 *
 * A FUNCTION, not a constant, because one of them may not be routed anywhere. The
 * typed-decision task is off by default; when it IS on, a person's own sentence and
 * their file go to a third party like everything else, so it joins the list and the
 * disclosure names them. A subprocessor nobody is told about is the failure this
 * screen exists to prevent.
 */
export const disclosedTasks = (): Task[] => [
  'chat', 'extract', 'resolve', 'reflect', 'render_profile', 'canon',
  ...(decideModel() ? (['decide'] as Task[]) : []),
];
// Every provider the router can reach. The app shows this to a person before their
// first message, so a missing entry is not cosmetic: the screen read "processed by
// unknown", which names nobody and satisfies neither the person nor the requirement
// that the provider be named.
const LABEL: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  typesafe: 'TypeSafe',
};

/** Exported so a test can check nothing routes to a provider with no name. */
export const LABELLED_PROVIDERS = new Set(Object.keys(LABEL));

/**
 * Served, not compiled in, so a model swap is not a binary release.
 *
 * Apple 5.1.2(i) (effective 2025-11-13) requires naming the third-party AI provider
 * and obtaining explicit permission before the first transmission. If that string
 * lived in the app bundle, every routing change would need App Review.
 *
 * The AI disclosure is per-SESSION, not onboarding-only: Anthropic's AUP requires
 * consumer chatbots disclose "at a minimum at the beginning of each chat session",
 * and an onboarding consent screen does not satisfy it. EU AI Act Art. 50 has been
 * in force since 2026-08-02.
 */
export const configRoutes = new Hono().get('/v1/config', (c) => {
  // THE EMBEDDING PROVIDER IS NAMED TOO (the founder's (f, h), 2026-09-29). Every message
  // and every remembered sentence is sent to it to be turned into numbers for search
  // (llm/embeddings.ts) -- a provider like the chat's, and the one nobody was told about:
  // with chat on Anthropic and embeddings on Gemini, the notice named Anthropic alone.
  const embeds = embeddingProvider();
  const providers = [...new Set([
    ...disclosedTasks().map((t) => LABEL[providerOf(modelFor(t))] ?? 'unknown'),
    ...(embeds === 'none' ? [] : [LABEL[embeds] ?? 'unknown']),
  ])].sort();
  return c.json({
    aiProviders: providers,
    // No links: /legal/privacy and /legal/safety were never served, and the app never
    // showed them. A privacy policy is the founder's to write; until one is published,
    // pointing at nothing promised a page that did not exist.
    disclosure: {
      perSession: `You are talking to an AI. Your messages are processed by ${providers.join(' and ')}.`,
    },
    limits: { maxMessageChars: 16_000 },
  });
});
