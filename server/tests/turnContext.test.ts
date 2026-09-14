/**
 * Regression: the turn being answered must not appear in its own context.
 *
 * The user's message is appended to `episodes` BEFORE context is assembled, because
 * the insert is what makes the turn idempotent. Without exclusions that message comes
 * back twice -- once as conversation history, once as a "fragment recalled from
 * before" -- and the clone answers the very first thing you ever say to it with
 * "you already told me that, same words."
 *
 * Found by running a real turn. No typecheck or unit test would have shown it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { pool, tenantSession } from '../src/db/client.js';
import { env } from '../src/env.js';
import { append, recentTurns } from '../src/memory/episodes.js';
import { recall } from '../src/memory/retrieval.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
let ctx = { tenantId: '', userId: '' };
const sessionId = '22222222-2222-2222-2222-222222222222';

beforeAll(async () => {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`turn-${Date.now()}`]);
  const tenantId = t.rows[0]!.id;
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `turn-${Date.now()}@example.test`]);
  ctx = { tenantId, userId: u.rows[0]!.id };
});

beforeEach(async () => {
  await owner.query('DELETE FROM episodes WHERE user_id = $1', [ctx.userId]);
});

afterAll(async () => {
  await owner.query('DELETE FROM tenants WHERE id = $1', [ctx.tenantId]);
  await owner.end();
  await pool.end();
});

const TEXT = "I'm Knox, I live in Bangalore and I'm building an AI clone app.";

async function storeTurn(text: string, turnId: string) {
  return tenantSession(ctx, (c) =>
    append(c, {
      tenantId: ctx.tenantId, userId: ctx.userId, sessionId, turnId,
      role: 'user', source: 'text', rawText: text, occurredAt: new Date(),
    }),
  );
}

describe('the current turn is excluded from its own context', () => {
  it('the very first message is not recalled as something said before', async () => {
    const turnId = '33333333-3333-3333-3333-333333333333';
    const stored = await storeTurn(TEXT, turnId);

    const recalled = await tenantSession(ctx, (c) =>
      recall(c, ctx.userId, TEXT, 5, stored!.id),
    );
    expect(recalled).toHaveLength(0);
  });

  it('without the exclusion it WOULD come back — proving the guard is load-bearing', async () => {
    const turnId = '44444444-4444-4444-4444-444444444444';
    await storeTurn(TEXT, turnId);
    const leaked = await tenantSession(ctx, (c) => recall(c, ctx.userId, TEXT, 5));
    expect(leaked.length).toBeGreaterThan(0);
  });

  it('conversation history omits the turn being answered', async () => {
    await storeTurn('First thing I said.', '55555555-5555-5555-5555-555555555555');
    const current = '66666666-6666-6666-6666-666666666666';
    await storeTurn('Second thing I said.', current);

    const recent = await tenantSession(ctx, (c) =>
      recentTurns(c, ctx.userId, sessionId, 20, current),
    );
    expect(recent.map((r) => r.content)).toEqual(['First thing I said.']);
  });

  it('genuinely earlier messages are still recalled', async () => {
    await storeTurn('I used to work at Acme in Bangalore.', '77777777-7777-7777-7777-777777777777');
    const current = '88888888-8888-8888-8888-888888888888';
    const stored = await storeTurn('Where did I work?', current);

    const recalled = await tenantSession(ctx, (c) =>
      recall(c, ctx.userId, 'Acme Bangalore', 5, stored!.id),
    );
    expect(recalled.map((r) => r.text)).toContain('I used to work at Acme in Bangalore.');
  });
});
