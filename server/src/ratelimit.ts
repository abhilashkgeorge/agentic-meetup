/**
 * A ceiling on how often one caller may knock.
 *
 * WHY IT EXISTS, AND WHY THE BUDGET CAP IS NOT ENOUGH. Every expensive path already
 * refuses to spend past a per-user daily cap. That cap is per USER, which is exactly
 * the wrong shape for the attack it has to survive: a script that creates a thousand
 * accounts gets a thousand caps. Device signup is unauthenticated by design -- an app
 * on a new phone provisions itself -- so the account-creation route is the one place
 * where "who is this" has no answer yet, and it is the route that manufactures new
 * budgets. It has to be limited by something other than identity.
 *
 * A FIXED WINDOW, not a token bucket. The bucket is the better algorithm and the
 * difference does not matter at the volumes this will see for a year: what matters is
 * that the thing exists at all and is easy to reason about when it fires. Rounder
 * numbers, plainer failure.
 *
 * IN MEMORY, and therefore PER PROCESS. This is honest for a single-replica server
 * and dishonest the moment there are two -- an attacker then gets one allowance per
 * replica. The WebSocket hub is already single-process for the same reason, so the
 * whole server moves to a shared store at once, and this note is where that decision
 * is recorded rather than discovered.
 *
 * NOT A SECURITY BOUNDARY BY ITSELF. An IP is shared by everybody behind one carrier
 * NAT and changed by anybody with a phone in aeroplane mode. It raises the cost of a
 * loop from nothing to something, which is the whole claim.
 */
import type { Context, Next } from 'hono';
import { log } from './log.js';

interface Window {
  /** When this window opened, in epoch ms. */
  since: number;
  hits: number;
}

const windows = new Map<string, Window>();

/**
 * Dropped periodically rather than on a timer per key: a key is a string and a
 * timer is an object, and at a thousand distinct callers the difference is the
 * whole memory profile. Unref'd, so it never holds the process open.
 */
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, w] of windows) {
    if (now - w.since > 10 * 60_000) windows.delete(key);
  }
}, 60_000);
sweeper.unref();

export interface Limit {
  /** How many requests are allowed in one window. */
  max: number;
  /** How long a window lasts, in milliseconds. */
  windowMs: number;
}

/** Exported so a test can start from a clean slate rather than from its neighbours. */
export function resetLimits(): void {
  windows.clear();
}

/**
 * Whether this caller may proceed, and what to tell them if not.
 *
 * Separate from the middleware so the WebSocket upgrade -- which is not a Hono
 * request and cannot run Hono middleware -- uses the same counter and the same
 * numbers as everything else.
 */
export function take(key: string, limit: Limit): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const w = windows.get(key);

  if (!w || now - w.since >= limit.windowMs) {
    windows.set(key, { since: now, hits: 1 });
    return { ok: true, retryAfterSec: 0 };
  }

  w.hits += 1;
  if (w.hits > limit.max) {
    return { ok: false, retryAfterSec: Math.ceil((limit.windowMs - (now - w.since)) / 1000) };
  }
  return { ok: true, retryAfterSec: 0 };
}

/**
 * The caller's address, as well as it can be known.
 *
 * `x-forwarded-for` is trusted here because this server is meant to sit behind one
 * proxy that sets it. A header a client can forge makes the limit bypassable by
 * anybody who reads this file -- so if this is ever exposed directly to the internet,
 * the proxy is the thing to add, not this line to remove.
 */
export function callerIp(headers: {
  get?: (k: string) => string | null | undefined;
  [k: string]: unknown;
}): string {
  const read = (k: string): string | undefined => {
    if (typeof headers.get === 'function') return headers.get(k) ?? undefined;
    const v = (headers as Record<string, unknown>)[k];
    return typeof v === 'string' ? v : Array.isArray(v) ? String(v[0]) : undefined;
  };
  const fwd = read('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return read('x-real-ip') ?? 'unknown';
}

/** Hono middleware form. `name` keeps separate routes on separate counters. */
export function rateLimit(name: string, limit: Limit) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const ip = callerIp(c.req.raw.headers);
    const { ok, retryAfterSec } = take(`${name}:${ip}`, limit);
    if (!ok) {
      log.warn({ name, ip }, 'rate limited');
      return c.json(
        { error: 'too_many_requests', message: 'Too many tries. Wait a moment.' },
        429,
        { 'Retry-After': String(retryAfterSec) },
      );
    }
    await next();
  };
}

/**
 * The numbers, in one place so they can be argued about in one place.
 *
 * Generous for a person and useless for a loop, which is the only property that
 * matters. A human redeeming an invite types it once and maybe mistypes it twice.
 */
export const LIMITS = {
  /** Account creation. The route that manufactures new daily budgets. */
  signup: { max: 5, windowMs: 60 * 60_000 },
  /** Invite redemption -- also the guess-a-code route. */
  redeem: { max: 10, windowMs: 60 * 60_000 },
  /** Everything else unauthenticated. */
  auth: { max: 30, windowMs: 60 * 60_000 },
  /** WebSocket upgrades. A reconnect loop is the honest failure this catches. */
  socket: { max: 60, windowMs: 5 * 60_000 },
  /** Messages pushed down one socket. */
  message: { max: 60, windowMs: 60_000 },
} as const;
