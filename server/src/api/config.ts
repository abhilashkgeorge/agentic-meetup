import { Hono } from 'hono';
import { modelFor } from '../llm/index.js';
import { providerOf, type Task } from '../llm/caps.js';

/** Every task whose provider a person is told about. Exported so a test can check
 *  that each one has a display name rather than falling through to "unknown". */
export const DISCLOSED_TASKS: Task[] =
  ['chat', 'extract', 'resolve', 'reflect', 'render_profile', 'canon'];
// Every provider the router can reach. The app shows this to a person before their
// first message, so a missing entry is not cosmetic: the screen read "processed by
// unknown", which names nobody and satisfies neither the person nor the requirement
// that the provider be named.
const LABEL: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
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
  const providers = [...new Set(DISCLOSED_TASKS.map((t) => LABEL[providerOf(modelFor(t))] ?? 'unknown'))].sort();
  return c.json({
    aiProviders: providers,
    disclosure: {
      perSession: `You are talking to an AI. Your messages are processed by ${providers.join(' and ')}.`,
      privacyUrl: '/legal/privacy',
      safetyProtocolUrl: '/legal/safety',
    },
    limits: { maxMessageChars: 16_000 },
  });
});
