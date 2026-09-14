/**
 * A ceiling on how often one caller may knock.
 *
 * WHY THE BUDGET CAP DOES NOT COVER THIS. Every expensive path already refuses to
 * spend past a per-user daily cap, and that cap is keyed on the USER -- exactly the
 * wrong shape for the attack it has to survive. A script that creates a thousand
 * accounts gets a thousand caps. Device signup is unauthenticated by design, so the
 * one route where "who is this" has no answer yet is also the route that manufactures
 * new budgets.
 *
 * Before this, nothing in the server limited anything by anything other than identity.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { LIMITS, callerIp, resetLimits, take } from '../src/ratelimit.js';

beforeEach(() => { resetLimits(); });

describe('the window', () => {
  it('allows exactly the stated number, then refuses', () => {
    const limit = { max: 3, windowMs: 60_000 };
    expect(take('k', limit).ok).toBe(true);
    expect(take('k', limit).ok).toBe(true);
    expect(take('k', limit).ok).toBe(true);
    const over = take('k', limit);
    expect(over.ok).toBe(false);
    // A number the caller can act on, rather than a bare refusal.
    expect(over.retryAfterSec).toBeGreaterThan(0);
  });

  it('counts each caller separately, so one loop cannot lock everybody out', () => {
    const limit = { max: 1, windowMs: 60_000 };
    expect(take('a', limit).ok).toBe(true);
    expect(take('a', limit).ok).toBe(false);
    expect(take('b', limit).ok).toBe(true);
  });

  it('counts each route separately', () => {
    const limit = { max: 1, windowMs: 60_000 };
    expect(take('signup:1.2.3.4', limit).ok).toBe(true);
    expect(take('signup:1.2.3.4', limit).ok).toBe(false);
    // Redeeming an invite must not be blocked by having signed up.
    expect(take('redeem:1.2.3.4', limit).ok).toBe(true);
  });

  it('lets a caller back in once the window has passed', () => {
    // A zero-length window is the boundary: the next call opens a fresh one.
    const limit = { max: 1, windowMs: 0 };
    expect(take('k', limit).ok).toBe(true);
    expect(take('k', limit).ok).toBe(true);
  });
});

describe('the numbers', () => {
  it('are generous for a person and useless for a loop', () => {
    // Signup is the route that manufactures budgets, so it is the tightest.
    expect(LIMITS.signup.max).toBeLessThanOrEqual(LIMITS.redeem.max);
    expect(LIMITS.redeem.max).toBeLessThanOrEqual(LIMITS.auth.max);
    // Every limit must actually limit something.
    for (const [name, l] of Object.entries(LIMITS)) {
      expect(l.max, `${name} allows unlimited`).toBeGreaterThan(0);
      expect(l.max, `${name} is too loose to matter`).toBeLessThan(1000);
      expect(l.windowMs, `${name} has no window`).toBeGreaterThan(0);
    }
  });
});

describe('the caller address', () => {
  it('takes the first hop of x-forwarded-for, not the last', () => {
    // The last entry is whatever the nearest proxy saw; the first is the client.
    const h = new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1, 10.0.0.2' });
    expect(callerIp(h)).toBe('203.0.113.9');
  });

  it('reads node-style header objects too, for the WebSocket upgrade', () => {
    // The upgrade handler is not a Hono request: it gets a plain object, and it has
    // to land on the same counter as everything else or the limit has a hole in it.
    expect(callerIp({ 'x-real-ip': '198.51.100.4' })).toBe('198.51.100.4');
    expect(callerIp({ 'x-forwarded-for': ['203.0.113.7'] })).toBe('203.0.113.7');
  });

  it('does not throw when there is no address at all', () => {
    // Everything anonymous then shares one bucket, which is the conservative answer.
    expect(callerIp({})).toBe('unknown');
  });
});
