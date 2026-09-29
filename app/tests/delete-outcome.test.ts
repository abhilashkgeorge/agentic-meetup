/**
 * "Delete everything" says only what the phone knows (lib/api.ts eraseAccount,
 * features/settings/delete-outcome.ts).
 *
 * WHAT WAS WRONG (docs/END-TO-END.md 15.2, the founder's (e), 2026-09-29): every failure
 * said "We could not reach the server. Nothing was removed." -- including an erasure that
 * ran half-way (the server's 500 with verified: false: some data gone, the rest kept) and
 * a connection lost after the server had started.
 *
 * WHAT IS PINNED, with the real module and fetch stood in: each server answer becomes the
 * outcome it means; "Nothing was removed" is said only when the server refused before
 * touching anything; a half-finished one says partly; no answer says it cannot tell; and
 * the phone signs out only when the account or the session is gone.
 *
 * Negative control, run by hand and recorded in the commit: eraseAccount treating a 500
 * as "unknown" whatever its body -> "a half-finished erasure says partly" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/env', () => ({ getApiBase: () => 'http://api.test' }));

import { eraseAccount } from '../src/lib/api';
import { eraseMessage, signsOut } from '../src/features/settings/delete-outcome';

const answer = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
afterEach(() => vi.unstubAllGlobals());

describe('deleting your account', () => {
  it('turns each server answer into what it means', async () => {
    answer(200, { verified: true });
    expect(await eraseAccount('t')).toBe('deleted');
    answer(500, { verified: false, remaining: ['facts'] });
    expect(await eraseAccount('t'), 'a half-finished erasure').toBe('partial');
    answer(400, { error: 'confirmation required' });
    expect(await eraseAccount('t')).toBe('refused');
    answer(401, { error: 'unauthorized' });
    expect(await eraseAccount('t')).toBe('signed_out');
    answer(502, 'bad gateway');
    expect(await eraseAccount('t')).toBe('unknown');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Network request failed'); }));
    expect(await eraseAccount('t')).toBe('unknown');
  });

  it('says "Nothing was removed" only when the server refused before touching anything', () => {
    expect(eraseMessage('refused')!.body).toMatch(/Nothing was removed/);
    for (const o of ['partial', 'signed_out', 'unknown'] as const) {
      expect(eraseMessage(o)!.body, o).not.toMatch(/Nothing was removed/);
    }
    expect(eraseMessage('deleted')).toBeNull();
  });

  it('says a half-finished erasure is partly done, and no answer that it cannot tell', () => {
    expect(eraseMessage('partial')!.title).toMatch(/partly/i);
    expect(eraseMessage('unknown')!.body).toMatch(/cannot tell/);
  });

  it('signs out only when the account or the session is gone', () => {
    expect(signsOut('deleted')).toBe(true);
    expect(signsOut('signed_out')).toBe(true);
    for (const o of ['partial', 'unknown', 'refused'] as const) expect(signsOut(o), o).toBe(false);
  });

  it('is what Settings says: the old sentence is gone (source shape)', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'settings', 'settings-screen.tsx'), 'utf8');
    expect(src).not.toMatch(/We could not reach the server\. Nothing was removed\./);
    expect(src).toMatch(/eraseMessage\(outcome\)/);
  });
});
