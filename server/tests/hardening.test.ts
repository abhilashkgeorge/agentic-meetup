/**
 * The guards that were decoration.
 *
 * WHAT HAPPENED. An adversarial review of the phone sign-in found twelve real
 * defects, and the worst of them were not in the new code at all -- they were in
 * checks that had been written, commented, believed, and never once executed:
 *
 *   six boot refusals   all written `NODE_ENV === 'production' && <unsafe thing>`,
 *                       on a value that defaulted to 'development' and that nothing
 *                       in the repo ever set. `npm start` is a bare node call.
 *   the per-IP limit    keyed on a header the caller sets, so a fresh value per
 *                       request meant a fresh budget per request.
 *   the limiter sweep   dropped every window at a flat ten minutes, so a limit with
 *                       a longer window got several budgets per window.
 *
 * Every test here is about a guard that LOOKED present. None of them would have
 * failed before the fix, because none of the code they cover ever ran.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { callerIp, take, resetLimits } from '../src/ratelimit.js';

const SRC = join(import.meta.dirname, '..', 'src');
const read = (f: string): string => readFileSync(join(SRC, f), 'utf8');

describe('boot refuses to guess', () => {
  it('has no default for NODE_ENV', () => {
    // A default here is what made all six refusals below it unreachable.
    const src = read('env.ts');
    const line = /NODE_ENV:\s*z\.enum\(\[[^\]]*\]\)([^,]*),/.exec(src);
    expect(line, 'NODE_ENV declaration not found').not.toBeNull();
    expect(line![1], 'NODE_ENV must have no default').not.toContain('default');
  });

  it('has no default for AUTH_SECRET', () => {
    // It used to fall back to a literal committed in this repository, which also
    // seeded the pepper for hashed phone numbers.
    const src = read('env.ts');
    const line = /AUTH_SECRET:\s*z\.string\(\)([^,]*),/.exec(src);
    expect(line, 'AUTH_SECRET declaration not found').not.toBeNull();
    expect(line![1], 'AUTH_SECRET must have no default').not.toContain('default');
  });

  it('refuses a production boot that has no phone pepper', () => {
    const src = read('env.ts');
    expect(src).toMatch(/NODE_ENV === 'production' && !env\.PHONE_PEPPER/);
  });
});

describe('the caller address', () => {
  it('IGNORES a forwarded header when no proxy is declared', () => {
    // The whole bypass: set the header, get a new counter, repeat. With no trusted
    // proxy the header must not be consulted at all.
    const spoofed = callerIp({ 'x-forwarded-for': '1.2.3.4' }, '203.0.113.7');
    expect(spoofed).toBe('203.0.113.7');
  });

  it('falls back to "unknown" rather than to something a caller wrote', () => {
    expect(callerIp({ 'x-forwarded-for': '1.2.3.4' })).toBe('unknown');
    expect(callerIp({ 'x-real-ip': '1.2.3.4' })).toBe('unknown');
  });

  it('refuses a peer address that is not an address', () => {
    // The value becomes a Map key and a database column, so an arbitrary string here
    // is unbounded growth in two places.
    expect(callerIp({}, 'x'.repeat(10_000))).toBe('unknown');
    expect(callerIp({}, 'not-an-ip')).toBe('unknown');
  });

  it('counts forwarded hops from the RIGHT when a proxy is declared', () => {
    // Taking the left-most entry is the classic version of this mistake: that is the
    // one the client wrote. Read through the source, because the hop count is env.
    const src = read('ratelimit.ts');
    expect(src).toContain('chain[chain.length - hops]');
    expect(src, 'must not take the first element').not.toMatch(/chain\[0\]/);
  });
});

describe('the rate limiter itself', () => {
  it('keeps a window for as long as that window lasts', () => {
    // The sweeper used a flat ten minutes for every key. A fifteen-minute or hourly
    // limit therefore had its counter deleted mid-window, handing out several
    // budgets per window to anybody patient enough to wait for the sweep.
    const src = read('ratelimit.ts');
    expect(src).toContain('now - w.since > w.windowMs');
    expect(src, 'the flat sweep is back').not.toMatch(/w\.since > 10 \* 60_000/);
  });

  it('actually stops a caller at the limit', () => {
    // The plain behaviour, asserted so the rewrite above did not break counting.
    resetLimits();
    const limit = { max: 3, windowMs: 60_000 };
    const results = [1, 2, 3, 4, 5].map(() => take('t:one', limit).ok);
    expect(results).toEqual([true, true, true, false, false]);
  });

  it('bounds how many callers it will remember', () => {
    const src = read('ratelimit.ts');
    expect(src).toMatch(/MAX_KEYS/);
  });
});

describe('spending money on texts', () => {
  it('sends only to countries that are on the list', () => {
    const src = read('api/auth.ts');
    expect(src).toContain('SMS_COUNTRIES.some');
    expect(src).toContain('country_not_supported');
  });

  it('has a ceiling that does not care who is asking', () => {
    // Per-IP is defeated by more hosts and per-number by more numbers. A global
    // daily count is defeated by neither.
    const src = read('api/auth.ts');
    expect(src).toContain("take('sms:global'");
  });

  it('bounds the cleanup that runs on the send path', () => {
    // Unqualified, this was a full-table DELETE inside the request's transaction:
    // the first request after a flood paid for every row the flood wrote.
    const src = read('api/auth.ts');
    const del = /DELETE FROM phone_challenges WHERE ctid IN \([\s\S]{0,200}?LIMIT \d+\)/.exec(src);
    expect(del, 'the expiry cleanup is unbounded again').not.toBeNull();
  });
});

describe('what reaches the log', () => {
  it('never writes a live invite code', () => {
    // A code is a credential until it is claimed, and a log line outlives it.
    const src = read('api/auth.ts');
    // SHORTHAND ONLY. `{ code }` puts the whole credential in the line; the redacted
    // form is `code: `${code.slice(0, 4)}…``, which contains the word `code` twice
    // and must not be flagged. My first version of this regex matched both and
    // reported four false positives, so it is the shorthand property that is matched
    // here: a `code` immediately followed by a comma or a closing brace.
    const bare = /log\.(info|warn|error)\(\{[^}]*[{,]\s*code\s*[,}]/g;
    expect(src.match(bare) ?? [], 'a bare `code` is being logged').toEqual([]);
  });

  it('writes the one-time code only from the console sender', () => {
    const src = read('sms.ts');
    // viaConsole exists to print it. Nothing else may.
    const logsCode = [...src.matchAll(/log\.\w+\(\{[^}]*\bcode\b[^}]*\}/g)];
    expect(logsCode).toHaveLength(1);
    expect(src.slice(0, src.indexOf(logsCode[0]![0]))).toContain('function viaConsole');
  });
});

describe('the database connections', () => {
  it('does not let sign-in traffic starve the background pipeline', () => {
    // phoneSession serves unauthenticated requests. Sharing discovery's two
    // connections meant a flood could stop the memory pipeline entirely.
    const src = read('db/client.ts');
    expect(src).toContain('_phonePool');
    expect(src).toMatch(/_phonePool \?\?= new Pool\(\{[\s\S]{0,200}connectionTimeoutMillis/);
  });
});
