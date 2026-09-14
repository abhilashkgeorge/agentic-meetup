/**
 * Regression: style and facts must not be served from the same block.
 *
 * `voice` lives in `core_profile` alongside identity/situation/preferences, which is
 * convenient and dangerous. `coreProfileText()` is inlined under the heading "What
 * you know about them" -- so if the voice block leaks into it, the clone treats "uses
 * lowercase, skips apostrophes" as a FACT about the person and says it back to them
 * ("you tend to write in lowercase"), instead of doing it.
 *
 * The separation is one `<>` in a WHERE clause. This test is what keeps it there.
 */
import { afterAll, beforeAll, expect, it, describe } from 'vitest';
import { Pool } from 'pg';
import { pool, tenantSession } from '../src/db/client.js';
import { env } from '../src/env.js';
import { coreProfileText, voiceText } from '../src/memory/profile.js';
import { saveVoice } from '../src/memory/chatImport.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
let ctx = { tenantId: '', userId: '' };

beforeAll(async () => {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`voice-${Date.now()}`]);
  const tenantId = t.rows[0]!.id;
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `voice-${Date.now()}@example.test`]);
  ctx = { tenantId, userId: u.rows[0]!.id };

  await owner.query(
    `INSERT INTO core_profile (tenant_id, user_id, block_name, content, token_count,
                               rendering_model, source_fact_ids, rebuilt_at)
     VALUES ($1,$2,'identity','Lives in Bangalore.',5,'test','{}', now())`,
    [ctx.tenantId, ctx.userId],
  );
});

afterAll(async () => {
  await owner.query('DELETE FROM tenants WHERE id = $1', [ctx.tenantId]);
  await owner.end();
  await pool.end();
});

describe('voice is stored with the profile but never served as profile', () => {
  it('saves, reads back, and stays out of the facts block', async () => {
    await tenantSession(ctx, (c) =>
      saveVoice(c, ctx, {
        style: 'Short lowercase one-liners.',
        habits: ['skips apostrophes'],
        never: ['never uses emoji'],
        messagesUsed: 30,
        costUsd: 0,
      }),
    );

    const [voice, profile] = await tenantSession(ctx, async (c) => [
      await voiceText(c, ctx.userId),
      await coreProfileText(c, ctx.userId),
    ]);

    expect(voice).toContain('Short lowercase one-liners.');
    expect(voice).toContain('skips apostrophes');
    expect(voice).toContain('never uses emoji');

    // The whole point: the facts block still has the facts, and none of the style.
    expect(profile).toContain('Lives in Bangalore');
    expect(profile).not.toContain('lowercase');
    expect(profile).not.toContain('apostrophes');
  });

  it('re-importing replaces the description rather than appending a second one', async () => {
    await tenantSession(ctx, (c) =>
      saveVoice(c, ctx, {
        style: 'Long careful paragraphs.',
        habits: [], never: [], messagesUsed: 40, costUsd: 0,
      }),
    );

    const voice = await tenantSession(ctx, (c) => voiceText(c, ctx.userId));
    expect(voice).toContain('Long careful paragraphs.');
    // A second import must not leave the old style sitting underneath the new one --
    // the clone would then be told to write two contradictory ways at once.
    expect(voice).not.toContain('Short lowercase one-liners.');
  });
});
