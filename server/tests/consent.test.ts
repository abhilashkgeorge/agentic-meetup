/**
 * Nobody ever agreed to anything.
 *
 * No terms, no privacy notice, no age attestation was captured anywhere in this
 * product. Migration 0036 enforces eighteen, which is the part that protects a minor;
 * this is the part that records the person saying it, which is what you need when
 * somebody asks later.
 *
 * The gate matters more than the record. A consent screen that does not stop anything
 * proves only that a dialog was rendered -- so the test that matters most here is the
 * one asserting an agent will not go out for somebody who never agreed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { REQUIRED, consentRoutes } from '../src/api/consent.js';
import { pool, tenantSession } from '../src/db/client.js';
import { env } from '../src/env.js';
import { commit } from '../src/memory/facts.js';
import { rebuildMatchProfile } from '../src/matching/profile.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
let ctx = { tenantId: '', userId: '' };
let token = '';

beforeAll(async () => {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`consent-${Date.now()}`]);
  const tenantId = t.rows[0]!.id;
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `consent-${Date.now()}@example.test`]);
  ctx = { tenantId, userId: u.rows[0]!.id };

  const { mintToken } = await import('../src/tokens.js');
  const s = await owner.query<{ id: string }>(
    `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
     VALUES (gen_random_uuid(), $1, $2, 'test', now() + interval '1 day') RETURNING id`,
    [tenantId, ctx.userId]);
  token = mintToken(s.rows[0]!.id);

  // Everything else a profile needs, so consent is the only variable under test.
  const f = (predicate: string, objectText: string, objectValue?: unknown) =>
    tenantSession(ctx, (c) => commit(c, ctx, {
      predicate, objectText, ...(objectValue !== undefined ? { objectValue } : {}),
      stance: 'asserted', originClass: 'owner', sourceQuote: objectText,
      sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
    }));
  await f('gender', 'man');
  await f('seeking_gender', 'woman');
  await f('relationship_intent', 'long term');
  await f('birth_date', '1994', { year: 1994, month: null });
  await f('lives_in', 'Bangalore',
    { city: 'bangalore', lat: 12.97, lon: 77.59, precision_km: 20 });
  // The five core cards are a pool condition too (profile.ts), so "otherwise
  // complete" includes them: done, "anyone", no rule.
  const { CORE } = await import('../src/onboarding/questions.js');
  for (const id of CORE) {
    await owner.query(
      `INSERT INTO question_answers (tenant_id, user_id, question_id, answer, skipped)
       VALUES ($1,$2,$3,'{"values":[],"whoFine":{"anyone":true}}'::jsonb, true)`,
      [tenantId, ctx.userId, id]);
  }
});

beforeEach(async () => {
  await owner.query('DELETE FROM consents WHERE user_id = $1', [ctx.userId]);
});

afterAll(async () => {
  await owner.query('DELETE FROM tenants WHERE id = $1', [ctx.tenantId]);
  await owner.end();
  await pool.end();
});

const req = (method: string, body?: unknown) =>
  consentRoutes.request('/v1/consent', {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

const acceptAll = () => req('POST', { accept: REQUIRED.map((r) => ({ document: r.document, version: r.version })) });
const rebuild = () => tenantSession(ctx, (c) => rebuildMatchProfile(c, ctx));

describe('the gate', () => {
  it('keeps an otherwise complete agent out of the pool until they agree', async () => {
    // Everything else about this profile is finished. This is the only thing missing.
    const before = await rebuild();
    expect(before.inPool).toBe(false);
    expect(before.missing).toContain('consent');

    expect((await acceptAll()).status).toBe(200);

    const after = await rebuild();
    expect(after.missing).not.toContain('consent');
    expect(after.inPool).toBe(true);
  });

  it('is not satisfied by agreeing to some of it', async () => {
    await req('POST', { accept: [{ document: 'age', version: '1' }] });
    const r = await rebuild();
    expect(r.missing).toContain('consent');
    expect(r.inPool).toBe(false);
  });
});

describe('the record', () => {
  it('says what is still outstanding', async () => {
    const body = await (await req('GET')).json() as {
      outstanding: { document: string }[]; settled: boolean;
    };
    expect(body.settled).toBe(false);
    expect(body.outstanding.map((o) => o.document).sort())
      .toEqual(REQUIRED.map((r) => r.document).sort());
  });

  it('is idempotent — agreeing twice is not an error and not two rows', async () => {
    await acceptAll();
    await acceptAll();
    const { rows } = await owner.query<{ n: string }>(
      'SELECT count(*) AS n FROM consents WHERE user_id = $1', [ctx.userId]);
    expect(Number(rows[0]!.n)).toBe(REQUIRED.length);
  });

  // The founder's (f, h), 2026-09-29: the privacy notice's words changed to match the
  // code, so what a person agreed to changed. Negative control, run by hand and recorded
  // in the commit: its version back to 1 -> this test fails.
  it('asks again for a privacy notice whose words changed: agreeing to version 1 no longer settles it', async () => {
    await owner.query(`INSERT INTO consents (tenant_id, user_id, document, version) VALUES ($1,$2,'privacy','1')`,
      [ctx.tenantId, ctx.userId]);
    await req('POST', { accept: REQUIRED.filter((r) => r.document !== 'privacy').map((r) => ({ document: r.document, version: r.version })) });
    const body = await (await req('GET')).json() as { outstanding: { document: string; version: string }[]; settled: boolean };
    expect(body.settled, 'the old privacy notice still counted').toBe(false);
    expect(body.outstanding).toEqual([expect.objectContaining({ document: 'privacy', version: '3' })]);
  });

  it('refuses a document this server never asked for', async () => {
    // Otherwise a client could manufacture a record of consent to something nobody
    // wrote, which is worse than having no record.
    const res = await req('POST', { accept: [{ document: 'whatever', version: '9' }] });
    expect(res.status).toBe(400);
    const { rows } = await owner.query('SELECT 1 FROM consents WHERE user_id = $1', [ctx.userId]);
    expect(rows.length).toBe(0);
  });

  it('cannot be edited by the application role', async () => {
    // A consent record the relying party can change is not evidence of anything.
    // 0039 grants SELECT and INSERT only; this proves the grant, not the intention.
    await acceptAll();
    await expect(
      tenantSession(ctx, (c) => c.query(
        `UPDATE consents SET accepted_at = now() - interval '1 year' WHERE user_id = $1`,
        [ctx.userId])),
    ).rejects.toThrow(/permission denied/i);
  });

  it('needs a credential', async () => {
    const res = await consentRoutes.request('/v1/consent');
    expect(res.status).toBe(401);
  });
});
