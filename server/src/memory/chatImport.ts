/**
 * Learn HOW the person talks, from a real chat export.
 *
 * Different job from fact extraction. Facts are what is true of someone; voice is how
 * they sound. Mixing them is a real failure -- style stored as a fact gets retrieved
 * and stated as though it were information about the person.
 *
 * ONLY THEIR MESSAGES ARE KEPT. The other person's lines are needed to see the
 * back-and-forth (how they open, how they react, how they disagree) and are then
 * discarded. Nothing the counterparty wrote is stored.
 */
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { parseChatExport, type ParsedChat } from '@clone/shared';

// Re-exported so existing server callers and tests keep one import site.
export { parseChatExport, type ParsedChat };
import { llm, modelFor } from '../llm/index.js';
import { modelIdOf } from '../llm/caps.js';

export const VOICE_PROMPT_VERSION = '2026-09-09.voice.1';

const Voice = z.object({
  /** Prose the reply prompt can use directly. */
  style: z.string(),
  /** Short, concrete habits. Easier to check and to show the user. */
  habits: z.array(z.string()),
  /** Things they never do. Negative rules are the ones models most often break. */
  never: z.array(z.string()),
});

export const VOICE_EXTRACTION_PROMPT = `You are reading one side of a real chat between two friends. Every line is from the SAME person. Describe how that person writes.

You are not summarising what they said. You are describing how they sound, so that someone could write a new message that reads as though they wrote it.

Cover:

- Length. Do they write one line or paragraphs? Several short messages in a row, or one long one?
- Capitals and punctuation. Do they capitalise? Use full stops? Ellipses? All caps when excited?
- Vocabulary. Slang, filler, swearing, abbreviations, words they reach for repeatedly.
- Emoji and reactions — which ones, how often, or never.
- Openings and sign-offs, if they have any.
- How they disagree, how they apologise, how they joke.
- Rhythm. Blunt and clipped? Rambling? Do they trail off?
- Anything distinctive a stranger would notice.

Rules:

Use their actual words as examples. Quote short fragments.

Describe what is THERE. If they never use emoji, that is a finding worth recording, not something to omit.

Do not flatter them and do not clean them up. If they are blunt or sweary or type in lowercase, say so plainly — a polished description produces a clone that does not sound like them.

Ignore the CONTENT of what they discuss. You are describing the voice, not the topics.`;

export interface VoiceResult {
  style: string;
  habits: string[];
  never: string[];
  messagesUsed: number;
  costUsd: number;
}

/**
 * `mine` is ONLY the user's own messages. The device parses the export, picks out the
 * speaker the person identified as themselves, and sends those lines and nothing
 * else -- so the counterparty's half never reaches this process, let alone the disk.
 * The signature takes a plain string array rather than a ParsedChat for exactly that
 * reason: there is no shape here that could carry somebody else's words by accident.
 */
export async function extractVoice(
  ctx: { tenantId: string; userId: string },
  mine: string[],
): Promise<VoiceResult | null> {
  if (mine.length < 20) return null; // too little to characterise honestly

  // Sample across the whole history, not just the start: how someone writes changes
  // with mood and time, and the first 200 messages are not representative.
  const step = Math.max(1, Math.floor(mine.length / 400));
  const sample = mine.filter((_, i) => i % step === 0).slice(0, 400);

  const model = modelFor('extract');
  const res = await llm.complete(
    {
      task: 'extract',
      instructions: VOICE_EXTRACTION_PROMPT,
      messages: [{ role: 'user', content: sample.map((t) => `- ${t}`).join('\n') }],
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      outputSchema: Voice,
      outputSchemaName: 'voice',
      cache: [{ scope: 'instructions', ttl: '5m' }],
      maxOutputTokens: 2048,
      thinking: false,
    },
    model,
  );

  const parsed = Voice.safeParse(res.parsed);
  if (!parsed.success) return null;

  return {
    style: parsed.data.style,
    habits: parsed.data.habits,
    never: parsed.data.never,
    messagesUsed: sample.length,
    costUsd: res.usage.costUsd,
  };
}

/** Stored as a core_profile block, so it is inlined on every turn like the rest. */
export async function saveVoice(
  c: PoolClient,
  ctx: { tenantId: string; userId: string },
  v: VoiceResult,
): Promise<void> {
  const content = [
    v.style,
    v.habits.length ? `\nHabits:\n${v.habits.map((h) => `- ${h}`).join('\n')}` : '',
    v.never.length ? `\nNever:\n${v.never.map((n) => `- ${n}`).join('\n')}` : '',
  ].join('');

  await c.query(
    `INSERT INTO core_profile (tenant_id, user_id, block_name, content, token_count,
                               rendering_model, source_fact_ids, rebuilt_at)
     VALUES ($1,$2,'voice',$3,$4,$5,'{}', now())
     ON CONFLICT (tenant_id, user_id, block_name) DO UPDATE
       SET content = EXCLUDED.content, token_count = EXCLUDED.token_count,
           rendering_model = EXCLUDED.rendering_model, rebuilt_at = now()`,
    [ctx.tenantId, ctx.userId, content, Math.ceil(content.length / 4),
     modelIdOf(modelFor('extract'))],
  );
}
