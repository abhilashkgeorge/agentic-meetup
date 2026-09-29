/**
 * The AI notice names every provider a person's words go to, and points at nothing the
 * server does not serve (api/config.ts).
 *
 * WHAT WAS WRONG (the founder's (f, h), 2026-09-29; docs/END-TO-END.md 15.2 item 10):
 * every message and remembered sentence also goes to the EMBEDDING provider, to be turned
 * into numbers for search (llm/embeddings.ts) -- and the notice named only the chat
 * providers: with chat on Anthropic and embeddings on Gemini it said "Anthropic" alone.
 * And it carried two links, /legal/privacy and /legal/safety, that the server never
 * served.
 *
 * WHAT IS PINNED, with chat on one company and embeddings on another (set here, before
 * anything reads the settings): both are named, and no /legal link is sent.
 *
 * Negative control, run by hand and recorded in the commit: the notice built from the
 * chat tasks alone -> "names the embedding provider" fails.
 */
import { afterAll, describe, expect, it } from 'vitest';

const TASK_MODELS = ['CHAT_MODEL', 'EXTRACT_MODEL', 'RESOLVE_MODEL', 'REFLECT_MODEL', 'RENDER_PROFILE_MODEL', 'CANON_MODEL'];
const was: Record<string, string | undefined> = {};
for (const k of [...TASK_MODELS, 'DECIDE_MODEL', 'GEMINI_API_KEY', 'OPENAI_API_KEY']) was[k] = process.env[k];
for (const k of TASK_MODELS) process.env[k] = 'anthropic:claude-sonnet-5';
process.env.DECIDE_MODEL = '';
process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.OPENAI_API_KEY = '';

const { configRoutes } = await import('../src/api/config.js');

afterAll(() => {
  for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('the AI notice', () => {
  it('names the embedding provider as well as the chat one', async () => {
    const body = await (await configRoutes.request('/v1/config')).json() as { aiProviders: string[]; disclosure: { perSession: string } };
    expect(body.aiProviders, 'the embedding provider went unnamed').toEqual(['Anthropic', 'Google']);
    expect(body.disclosure.perSession).toBe('You are talking to an AI. Your messages are processed by Anthropic and Google.');
  });

  it('points at no page the server does not serve', async () => {
    const body = await (await configRoutes.request('/v1/config')).json() as { disclosure: Record<string, unknown> };
    expect(JSON.stringify(body)).not.toMatch(/\/legal\//);
    expect(Object.keys(body.disclosure)).toEqual(['perSession']);
  });
});
